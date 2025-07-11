// netlify/functions/submit-invoice.js
const { Client } = require('@notionhq/client');
const multipart = require('lambda-multipart-parser');

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Brand configurations
const BRAND_CONFIGS = {
  'dr-dent': {
    name: 'dr-dent',
    displayName: 'Dr Dent',
    billingDetails: {
      companyName: 'Galactic Brands LTD',
      address: `19 Haines Place
Bewdley Street
Evesham
WR11 4AD
GB`,
      email: 'billing@galacticbrands.com',
      phone: '+44 xxx xxx xxxx'
    },
    retainerTiers: {
      'tier1': { name: 'Tier 1', gmvRange: '<£10k', amount: 450 },
      'tier2': { name: 'Tier 2', gmvRange: '£10k - £25k', amount: 600 },
      'tier3': { name: 'Tier 3', gmvRange: '£25k - £50k', amount: 850 },
      'tier4': { name: 'Tier 4', gmvRange: '£50k+', amount: 1000 }
    }
  }
};

function getBrandConfig(brandKey) {
  return BRAND_CONFIGS[brandKey] || BRAND_CONFIGS['dr-dent'];
}

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    console.log('Processing form submission...');
    
    // Parse multipart form data
    const result = await multipart.parse(event);
    
    // Extract form data - it should be in result.data field
    let formData;
    if (result.data) {
      formData = JSON.parse(result.data);
    } else {
      // Fallback: try to parse body directly
      formData = JSON.parse(event.body);
    }

    console.log('Parsed form data:', formData);

    // Build the invoice title properly
    const invoicePeriod = formData.period || new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const invoiceTypeText = formData.invoiceType === 'retainer' ? 'Monthly Retainer' : 'Rewards Campaign';
    const invoiceTitle = `${formData.name || 'New Submission'} - ${invoiceTypeText} - ${invoicePeriod}`;

    console.log('Creating invoice title:', invoiceTitle);

    // Build properties for Notion database
    const properties = {
      'Invoice Title': {
        title: [
          {
            text: {
              content: invoiceTitle,
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

    // Add form fields to properties
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

    // Always set brand to Dr Dent for now
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

    // Bank details
    if (formData.bankName || formData.accountName || formData.accountNumber || formData.sortCode) {
      const bankDetails = [];
      if (formData.bankName) bankDetails.push(`Bank: ${formData.bankName}`);
      if (formData.accountName) bankDetails.push(`Account: ${formData.accountName}`);
      if (formData.accountNumber) bankDetails.push(`Number: ${formData.accountNumber}`);
      if (formData.sortCode) bankDetails.push(`Sort: ${formData.sortCode}`);
      
      properties['Bank Details'] = {
        rich_text: [
          {
            text: {
              content: bankDetails.join(', '),
            },
          },
        ],
      };
    }

    // VAT information for business submissions
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

    // Set due date to today
    properties['Due Date'] = {
      date: {
        start: new Date().toISOString().split('T')[0],
      },
    };

    // Handle file uploads (screenshots)
    if (result.files && result.files.length > 0) {
      console.log(`Received ${result.files.length} files`);
      
      const fileInfo = result.files.map((file, index) => {
        return `File ${index + 1}: ${file.filename} (${(file.content.length / 1024).toFixed(2)} KB)`;
      }).join('\n');
      
      properties['Screenshots'] = {
        rich_text: [
          {
            text: {
              content: `Screenshots uploaded:\n${fileInfo}`,
            },
          },
        ],
      };
    }

    // Create the Notion page
    console.log('Creating Notion page with properties:', JSON.stringify(properties, null, 2));

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
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: JSON.stringify({
        success: true,
        message: 'Invoice submitted successfully',
        notionPageId: response.id,
        invoiceTitle: invoiceTitle,
      }),
    };

  } catch (error) {
    console.error('Error processing submission:', error);
    console.error('Error details:', error.body || error.message);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to submit invoice',
        details: error.body || 'No additional details',
      }),
    };
  }
};
