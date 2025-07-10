// netlify/functions/submit-invoice.js - More Robust Version
const { Client } = require('@notionhq/client');

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Helper function to extract JSON from multipart data
function extractFormDataFromMultipart(body) {
  console.log('Processing multipart body, length:', body.length);
  
  // Try multiple extraction methods
  const extractionMethods = [
    // Method 1: Look for data field with proper boundaries
    () => {
      const match = body.match(/Content-Disposition: form-data; name="data"\r?\n\r?\n([\s\S]*?)\r?\n-+/);
      return match ? match[1].trim() : null;
    },
    
    // Method 2: Look for data field with simpler pattern
    () => {
      const match = body.match(/name="data"\r?\n\r?\n([\s\S]*?)\r?\n-/);
      return match ? match[1].trim() : null;
    },
    
    // Method 3: Look for any JSON-like structure
    () => {
      const match = body.match(/\{[\s\S]*"name"[\s\S]*"email"[\s\S]*\}/);
      return match ? match[0] : null;
    },
    
    // Method 4: Extract everything between quotes that looks like JSON
    () => {
      const jsonPattern = /\{[^{}]*"[^"]*"[^{}]*:[^{}]*"[^"]*"[^{}]*\}/g;
      const matches = body.match(jsonPattern);
      if (matches) {
        // Find the largest match (most likely to be our form data)
        return matches.reduce((a, b) => a.length > b.length ? a : b);
      }
      return null;
    }
  ];
  
  for (let i = 0; i < extractionMethods.length; i++) {
    try {
      const extracted = extractionMethods[i]();
      if (extracted) {
        console.log(`Method ${i + 1} extracted:`, extracted.substring(0, 100));
        const parsed = JSON.parse(extracted);
        if (parsed.name || parsed.email) {
          console.log(`✅ Method ${i + 1} successful!`);
          return parsed;
        }
      }
    } catch (error) {
      console.log(`Method ${i + 1} failed:`, error.message);
    }
  }
  
  throw new Error('Could not extract valid JSON data from multipart form');
}

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
    console.log('=== PROCESSING INVOICE SUBMISSION ===');
    console.log('Content-Type:', event.headers['content-type']);
    console.log('Body length:', event.body?.length);
    console.log('Is Base64 encoded:', event.isBase64Encoded);

    let formData;

    // Handle different content types
    if (event.headers['content-type']?.includes('application/json')) {
      console.log('Processing as JSON...');
      formData = JSON.parse(event.body);
    } else if (event.headers['content-type']?.includes('multipart/form-data')) {
      console.log('Processing as multipart...');
      
      const body = event.isBase64Encoded ? 
        Buffer.from(event.body, 'base64').toString() : 
        event.body;
      
      console.log('Raw body sample (first 300 chars):', body.substring(0, 300));
      console.log('Raw body sample (last 300 chars):', body.substring(body.length - 300));
      
      formData = extractFormDataFromMultipart(body);
    } else {
      throw new Error(`Unsupported content type: ${event.headers['content-type']}`);
    }

    // Validate that we got valid data
    if (!formData || typeof formData !== 'object') {
      throw new Error('No valid form data received');
    }

    console.log('=== PARSED FORM DATA ===');
    console.log('Name:', formData.name);
    console.log('Email:', formData.email);
    console.log('Invoice Type:', formData.invoiceType);
    console.log('Period:', formData.period);
    console.log('Selected Tier:', formData.selectedTier);
    console.log('Submission Type:', formData.submissionType);

    // Test database connection
    try {
      const dbTest = await notion.databases.retrieve({
        database_id: DATABASE_ID
      });
      console.log('✅ Database connected:', dbTest.title[0]?.plain_text);
    } catch (dbError) {
      console.error('❌ Database connection failed:', dbError);
      throw new Error(`Database connection failed: ${dbError.message}`);
    }

    // Build proper invoice title
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

    // Add all the other properties
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

    // Add note about files
    if (formData.accounts && formData.accounts.some(acc => acc.fileCount > 0)) {
      const totalFiles = formData.accounts.reduce((sum, acc) => sum + (acc.fileCount || 0), 0);
      properties['Screenshots'] = {
        rich_text: [
          {
            text: {
              content: `${totalFiles} screenshot(s) were uploaded for review`,
            },
          },
        ],
      };
    }

    console.log('=== CREATING NOTION PAGE ===');
    console.log('Properties keys:', Object.keys(properties));

    // Create page in Notion
    const response = await notion.pages.create({
      parent: {
        type: "database_id",
        database_id: DATABASE_ID,
      },
      properties: properties,
    });

    console.log('✅ Successfully created Notion page:', response.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Invoice submitted successfully',
        notionPageId: response.id,
        invoiceTitle: titleText, // Return this for debugging
      }),
    };

  } catch (error) {
    console.error('❌ Error submitting to Notion:', error);
    console.error('Error stack:', error.stack);
    
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
