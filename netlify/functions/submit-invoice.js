const { Client } = require('@notionhq/client');

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ message: 'Method not allowed' }),
    };
  }

  try {
    console.log('Received form submission:', event.body);
    
    // Parse the form data
    const formData = JSON.parse(event.body);

    // Build properties object for Notion (your existing code)
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

    // Add other properties from your server.js
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

    // Create page in Notion database
    const response = await notion.pages.create({
      parent: {
        type: "database_id",
        database_id: DATABASE_ID,
      },
      properties: properties,
    });

    console.log('Created Notion page:', response.id);

    // Return success response
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
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
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to submit invoice',
      }),
    };
  }
};
