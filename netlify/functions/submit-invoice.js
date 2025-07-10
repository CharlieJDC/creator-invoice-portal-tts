// netlify/functions/submit-invoice.js - Simple JSON only (no files for now)
const { Client } = require('@notionhq/client');

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    console.log('=== PROCESSING INVOICE ===');
    
    // ONLY accept JSON for now - no multipart
    if (!event.headers['content-type']?.includes('application/json')) {
      throw new Error('Only JSON content type supported');
    }

    const formData = JSON.parse(event.body);
    
    console.log('Form data received:');
    console.log('Name:', formData.name);
    console.log('Email:', formData.email);
    console.log('Period:', formData.period);
    console.log('Invoice Type:', formData.invoiceType);

    // Build the invoice title
    const invoiceTitle = `${formData.name} - ${formData.invoiceType === 'retainer' ? 'Monthly Retainer' : 'Rewards'} - ${formData.period}`;
    console.log('Generated title:', invoiceTitle);

    // Test database connection
    const dbTest = await notion.databases.retrieve({ database_id: DATABASE_ID });
    console.log('Database connected:', dbTest.title[0]?.plain_text);

    // Build properties
    const properties = {
      'Invoice Title': {
        title: [{ text: { content: invoiceTitle } }],
      },
      'Status': {
        status: { name: 'Pending' },
      },
      'Email': {
        email: formData.email,
      },
      'Name 1': {
        rich_text: [{ text: { content: formData.name } }],
      },
      'Brand 1': {
        select: { name: 'Dr Dent' },
      },
      'Invoice Type': {
        select: { name: formData.invoiceType === 'retainer' ? 'Monthly Retainer' : 'Rewards' },
      },
      'Period': {
        select: { name: formData.period },
      },
      'Due Date': {
        date: { start: new Date().toISOString().split('T')[0] },
      },
    };

    // Add optional fields
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
        select: { name: formData.submissionType === 'individual' ? 'Individual' : 'Business' },
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
        rich_text: [{ text: { content: formData.accounts.map(acc => acc.handle).join(', ') } }],
      };
      
      const totalFiles = formData.accounts.reduce((sum, acc) => sum + (acc.fileCount || 0), 0);
      if (totalFiles > 0) {
        properties['Screenshots'] = {
          rich_text: [{ text: { content: `${totalFiles} screenshot(s) selected (files will be handled separately)` } }],
        };
      }
    }

    if (formData.address) {
      properties['Address'] = {
        rich_text: [{ text: { content: formData.address } }],
      };
    }

    if (formData.bankName) {
      properties['Bank Details'] = {
        rich_text: [{ text: { content: `Bank: ${formData.bankName}, Account: ${formData.accountName}, Number: ${formData.accountNumber}, Sort: ${formData.sortCode}` } }],
      };
    }

    // VAT information
    if (formData.submissionType === 'business' && formData.vatRegistered) {
      properties['VAT Status'] = {
        select: { name: formData.vatRegistered === 'yes' ? 'VAT Registered' : 'Not VAT Registered' },
      };
      
      if (formData.vatNumber) {
        properties['VAT Number'] = {
          rich_text: [{ text: { content: formData.vatNumber } }],
        };
      }
    }

    console.log('Creating Notion page...');

    // Create the Notion page
    const response = await notion.pages.create({
      parent: { type: "database_id", database_id: DATABASE_ID },
      properties: properties,
    });

    console.log('✅ SUCCESS! Created page:', response.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Invoice submitted successfully',
        notionPageId: response.id,
        invoiceTitle: invoiceTitle,
      }),
    };

  } catch (error) {
    console.error('❌ ERROR:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
};
