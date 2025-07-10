// netlify/functions/submit-invoice.js
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

    let formData;
    let files = [];

    console.log('Event body type:', typeof event.body);
    console.log('Event isBase64Encoded:', event.isBase64Encoded);

    // Try to parse the body
    try {
      if (event.headers['content-type']?.includes('multipart/form-data')) {
        // For now, let's just extract the JSON data part and skip files
        // This is a simplified approach - you may need a proper multipart parser
        const body = event.isBase64Encoded ? 
          Buffer.from(event.body, 'base64').toString() : 
          event.body;
        
        // Look for the JSON data in the multipart body
        const dataMatch = body.match(/name="data"\r?\n\r?\n(.*?)\r?\n/);
        if (dataMatch) {
          formData = JSON.parse(dataMatch[1]);
        } else {
          throw new Error('Could not find form data in multipart body');
        }
      } else {
        // Regular JSON body
        formData = JSON.parse(event.body);
      }
    } catch (parseError) {
      console.error('Error parsing request body:', parseError);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Invalid request format',
          details: parseError.message,
        }),
      };
    }

    console.log('Parsed form data:', JSON.stringify(formData, null, 2));
    console.log('Number of files:', files.length);

    // Build properties object for Notion
    const properties = {
      'Invoice Title': {
        title: [
          {
            text: {
              content: `${formData.name || 'New'} - ${formData.invoiceType || 'Invoice'} - ${formData.period || new Date().toISOString().split('T')[0]}`,
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

    // Add optional properties
    if (formData.email) {
      properties['Email'] = {
        email: formData.email,
      };
    }

    if (formData.name) {
      properties['Name 1'] = {
        rich_text: [
          {
            text: {
              content: formData.name,
            },
          },
        ],
      };
    }

    if (formData.discord) {
      properties['Discord Username'] = {
        rich_text: [
          {
            text: {
              content: formData.discord,
            },
          },
        ],
      };
    }

    if (formData.phone) {
      properties['Phone'] = {
        phone_number: formData.phone,
      };
    }

    if (formData.submissionType) {
      properties['Submission Type'] = {
        select: {
          name: formData.submissionType === 'individual' ? 'Individual' : 'Business',
        },
      };
    }

    properties['Brand 1'] = {
      select: {
        name: 'Dr Dent',
      },
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
        select: {
          name: formData.period,
        },
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
        select: {
          name: tierMap[formData.selectedTier],
        },
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
        rich_text: [
          {
            text: {
              content: formData.address,
            },
          },
        ],
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

    // Add VAT information if business submission
    if (formData.submissionType === 'business' && formData.vatRegistered) {
      properties['VAT Status'] = {
        select: {
          name: formData.vatRegistered === 'yes' ? 'VAT Registered' : 'Not VAT Registered',
        },
      };
      
      if (formData.vatNumber) {
        properties['VAT Number'] = {
          rich_text: [
            {
              text: {
                content: formData.vatNumber,
              },
            },
          ],
        };
      }
    }

    properties['Due Date'] = {
      date: {
        start: new Date().toISOString().split('T')[0],
      },
    };

    // Handle file uploads - store as text since we can't upload to Notion directly
    if (files.length > 0) {
      const fileInfo = files.map((file, index) => 
        `File ${index + 1}: ${file.filename} (${Math.round(file.content.length / 1024)}KB)`
      ).join('\n');
      
      properties['Screenshots'] = {
        rich_text: [
          {
            text: {
              content: `${files.length} screenshot(s) uploaded:\n${fileInfo}`,
            },
          },
        ],
      };
    }

    // Create page in Notion
    const response = await notion.pages.create({
      parent: {
        type: "database_id",
        database_id: DATABASE_ID,
      },
      properties: properties,
    });

    console.log('Created Notion page:', response.id);

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
