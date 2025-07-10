// pages/api/submit-invoice.js
const { Client } = require('@notionhq/client');

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const formData = req.body;

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

    const response = await notion.pages.create({
      parent: {
        type: "database_id",
        database_id: DATABASE_ID,
      },
      properties: properties,
    });

    res.json({
      success: true,
      message: 'Invoice submitted successfully',
      notionPageId: response.id,
    });

  } catch (error) {
    console.error('Error submitting to Notion:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to submit invoice',
    });
  }
}
