// netlify/functions/submit-invoice.js - Simplified version
const { Client } = require('@notionhq/client');

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

exports.handler = async (event, context) => {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    console.log('Processing invoice submission...');
    console.log('Content-Type:', event.headers['content-type']);
    console.log('Event body (first 200 chars):', event.body?.substring(0, 200));

    let formData;

    // Handle different content types
    if (event.headers['content-type']?.includes('application/json')) {
      // Direct JSON
      formData = JSON.parse(event.body);
    } else if (event.headers['content-type']?.includes('multipart/form-data')) {
      // Extract JSON data from multipart (ignore files for now)
      const body = event.isBase64Encoded ? 
        Buffer.from(event.body, 'base64').toString() : 
        event.body;
      
      console.log('Multipart body sample:', body.substring(0, 500));
      
      // Try different regex patterns to find the data field
      let dataMatch = body.match(/name="data"\r?\n\r?\n([\s\S]*?)\r?\n--/);
      if (!dataMatch) {
        dataMatch = body.match(/name="data"\r?\n\r?\n([\s\S]*?)\r?\n-/);
      }
      if (!dataMatch) {
        dataMatch = body.match(/name="data"[^}]*\r?\n\r?\n([\s\S]*?)(?:\r?\n--|\r?\n-)/);
      }
      
      if (dataMatch) {
        console.log('Found data match:', dataMatch[1].substring(0, 200));
        formData = JSON.parse(dataMatch[1].trim());
      } else {
        console.log('No data match found, trying to find any JSON in body...');
        // Look for any JSON-like content
        const jsonMatch = body.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          console.log('Found JSON match:', jsonMatch[0].substring(0, 200));
          formData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Could not find data field in multipart form');
        }
      }
    } else {
      throw new Error('Unsupported content type');
    }

    console.log('Successfully parsed form data:');
    console.log('- Name:', formData.name);
    console.log('- Email:', formData.email);
    console.log('- Invoice Type:', formData.invoiceType);
    console.log('- Period:', formData.period);
    console.log('- Selected Tier:', formData.selectedTier);

    // Test database connection first
    try {
      const dbTest = await notion.databases.retrieve({
        database_id: DATABASE_ID
      });
      console.log('Database connected:', dbTest.title[0]?.plain_text);
    } catch (dbError) {
      console.error('Database connection failed:', dbError);
      throw new Error(`Database connection failed: ${dbError.message}`);
    }

    // Build a proper invoice title
    const invoiceTypeText = formData.invoiceType === 'retainer' ? 'Monthly Retainer' : 'Rewards Campaign';
    const titleText = `${formData.name || 'Unknown'} - ${invoiceTypeText} - ${formData.period || 'No Period'}`;
    
    console.log('Generated title:', titleText);

    // Build properties object for Notion
    const properties = {
      'Invoice Title': {
        title: [
          {
            text: {
              content: titleText,
            },
          },
        ],
      },
      'Status': {
        status: {
          name: 'Pending',
        },
      },
    };

    // Add required properties
    if (formData.email) {
      properties['Email'] = { email: formData.email };
    }

    if (formData.name) {
      properties['Name 1'] = {
        rich_text: [{ text: { content: formData.name } }],
      };
    }

    if (formData.discord) {
      properties['Discord Username'] = {
        rich_text: [{ text: { content: formData.discord } }],
      };
    }

    if (formData.phone) {
      properties['Phone'] = { phone_number: formData.phone };
    }

    if (formData.submissionType) {
      properties['Submission Type'] = {
        select: {
          name: formData.submissionType === 'individual' ? 'Individual' : 'Business',
        },
      };
    }

    properties['Brand 1'] = {
      select: { name: 'Dr Dent' },
    };

    if (formData.invoiceType) {
      properties['Invoice Type'] = {
        select: {
          name: formData.invoiceType === 'retainer' ? 'Monthly Retainer' : 'Rewards',
        },
      };
    }

    if (formData.period) {
      properties['Period'] = {
        select: { name: formData.period },
      };
    }

    if (formData.selectedTier) {
      const tierMap = {
        'tier1': 'Tier 1',
        'tier2': 'Tier 2', 
        'tier3': 'Tier 3',
        'tier4': 'Tier 4'
      };
      properties['Selected Tier'] = {
        select: { name: tierMap[formData.selectedTier] },
      };
    }

    if (formData.accounts && formData.accounts.length > 0) {
      properties['TikTok Handle'] = {
        rich_text: [
          {
            text: {
              content: formData.accounts.map(acc => acc.handle).join(', '),
            },
          },
        ],
      };
    }

    if (formData.address) {
      properties['Address'] = {
        rich_text: [{ text: { content: formData.address } }],
      };
    }

    if (formData.bankName) {
      properties['Bank Details'] = {
        rich_text: [
          {
            text: {
              content: `Bank: ${formData.bankName}, Account: ${formData.accountName}, Number: ${formData.accountNumber}, Sort: ${formData.sortCode}`,
            },
          },
        ],
      };
    }

    // Add VAT information
    if (formData.submissionType === 'business' && formData.vatRegistered) {
      properties['VAT Status'] = {
        select: {
          name: formData.vatRegistered === 'yes' ? 'VAT Registered' : 'Not VAT Registered',
        },
      };
      
      if (formData.vatNumber) {
        properties['VAT Number'] = {
          rich_text: [{ text: { content: formData.vatNumber } }],
        };
      }
    }

    properties['Due Date'] = {
      date: { start: new Date().toISOString().split('T')[0] },
    };

    // Add note about files (since we're not processing them yet)
    if (formData.accounts && formData.accounts.some(acc => acc.fileCount > 0)) {
      const totalFiles = formData.accounts.reduce((sum, acc) => sum + (acc.fileCount || 0), 0);
      properties['Screenshots'] = {
        rich_text: [
          {
            text: {
              content: `${totalFiles} screenshot(s) were uploaded but need manual processing`,
            },
          },
        ],
      };
    }

    console.log('Creating Notion page with properties:', Object.keys(properties));

    // Create page in Notion
    const response = await notion.pages.create({
      parent: {
        type: "database_id",
        database_id: DATABASE_ID,
      },
      properties: properties,
    });

    console.log('Successfully created Notion page:', response.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Invoice submitted successfully',
        notionPageId: response.id,
      }),
    };

  } catch (error) {
    console.error('Error submitting to Notion:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to submit invoice',
        details: error.toString(),
      }),
    };
  }
};
