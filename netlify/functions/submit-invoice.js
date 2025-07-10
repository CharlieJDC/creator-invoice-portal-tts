// netlify/functions/submit-invoice.js - Fixed version based on what was working
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

    // Handle different content types
    if (event.headers['content-type']?.includes('application/json')) {
      // Direct JSON
      formData = JSON.parse(event.body);
    } else if (event.headers['content-type']?.includes('multipart/form-data')) {
      // Extract JSON data from multipart (ignore files for now)
      const body = event.isBase64Encoded ? 
        Buffer.from(event.body, 'base64').toString() : 
        event.body;
      
      // Simple extraction - look for the complete JSON between boundaries
      const lines = body.split('\n');
      let inDataSection = false;
      let jsonLines = [];
      
      for (let line of lines) {
        if (line.includes('name="data"')) {
          inDataSection = true;
          continue;
        }
        if (inDataSection) {
          if (line.startsWith('-') || line.includes('Content-Disposition')) {
            break;
          }
          if (line.trim()) {
            jsonLines.push(line);
          }
        }
      }
      
      const jsonString = jsonLines.join('').trim();
      console.log('Extracted JSON:', jsonString);
      
      if (jsonString) {
        formData = JSON.parse(jsonString);
      } else {
        throw new Error('Could not find data field in multipart form');
      }
    } else {
      throw new Error('Unsupported content type');
    }

    console.log('Successfully parsed form data:', formData.name, formData.email, formData.period);

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

    // Build properties object, excluding undefined values
    const properties = {
      // Map form fields to your Notion database properties
      'Invoice Title': {
        title: [
          {
            text: {
              content: `${formData.name || 'New'} - ${formData.invoiceType === 'retainer' ? 'Monthly Retainer' : 'Rewards'} - ${formData.period || new Date().toISOString().split('T')[0]}`,
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

    // Add optional properties only if they exist
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
        ];
      }
    }

    properties['Due Date'] = {
      date: {
        start: new Date().toISOString().split('T')[0], // Today's date
      },
    };

    // Add note about screenshots
    if (formData.accounts && formData.accounts.some(acc => acc.fileCount > 0)) {
      const totalFiles = formData.accounts.reduce((sum, acc) => sum + (acc.fileCount || 0), 0);
      properties['Screenshots'] = {
        rich_text: [
          {
            text: {
              content: `${totalFiles} screenshot(s) uploaded for review`,
            },
          },
        ],
      };
    }

    // Create page in Notion database with correct structure
    const response = await notion.pages.create({
      parent: {
        type: "database_id",
        database_id: DATABASE_ID,
      },
      properties: properties,
    });

    console.log('Created Notion page:', response.id);

    // Send success response
    const responseData = {
      success: true,
      message: 'Invoice submitted successfully',
      notionPageId: response.id,
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(responseData),
    };

  } catch (error) {
    console.error('Error submitting to Notion:', error);
    console.error('Error details:', error.body);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to submit invoice',
      }),
    };
  }
};
