// netlify/functions/submit-invoice.js
const { Client } = require('@notionhq/client');
const multipart = require('lambda-multipart-parser');
const PDFDocument = require('pdfkit');

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

// Generate PDF invoice using PDFKit
async function generateInvoicePDF(formData) {
  return new Promise((resolve, reject) => {
    try {
      const brandConfig = getBrandConfig('dr-dent');
      const tierAmount = brandConfig.retainerTiers[formData.selectedTier]?.amount || 450;
      
      // VAT calculation
      const isVatRegistered = formData.submissionType === 'business' && formData.vatRegistered === 'yes';
      const vatRate = 0.20;
      const netAmount = tierAmount;
      const vatAmount = isVatRegistered ? Math.round(netAmount * vatRate * 100) / 100 : 0;
      const totalAmount = netAmount + vatAmount;
      
      const invoiceNumber = `DR-DENT-${Date.now()}`;
      const doc = new PDFDocument({ margin: 50 });
      
      let buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve({
          buffer: pdfData,
          filename: `invoice-${invoiceNumber}.pdf`,
          invoiceNumber: invoiceNumber
        });
      });
      
      // Brand header
      doc.fontSize(16).text(brandConfig.billingDetails.companyName, 50, 50);
      doc.fontSize(10).text(brandConfig.billingDetails.address, 50, 75);
      
      // Invoice title
      doc.fontSize(32).text('INVOICE', 50, 150, { align: 'center' });
      
      // Invoice details
      doc.fontSize(12).text('BILLED TO:', 50, 220);
      doc.fontSize(10).text(formData.name, 50, 240);
      if (formData.address) {
        doc.text(formData.address, 50, 255);
      }
      
      doc.fontSize(12).text('DATE:', 400, 220);
      doc.fontSize(10).text(new Date().toLocaleDateString('en-GB'), 400, 240);
      
      doc.fontSize(12).text('INVOICE #:', 400, 260);
      doc.fontSize(10).text(invoiceNumber, 400, 280);
      
      // Task section
      const taskY = 320;
      doc.fontSize(12).text('TASK', 50, taskY);
      doc.text('TOTAL', 450, taskY);
      
      const taskText = formData.invoiceType === 'retainer' ? 
        `Monthly retainer for ${brandConfig.displayName} - ${formData.period}` : 
        `${formData.period} campaign`;
      
      doc.fontSize(10).text(taskText, 50, taskY + 20);
      doc.text(`£${netAmount}`, 450, taskY + 20);
      
      if (isVatRegistered) {
        doc.text('VAT (20%)', 50, taskY + 40);
        doc.text(`£${vatAmount}`, 450, taskY + 40);
      }
      
      // Total
      doc.fontSize(14).text('TOTAL DUE', 350, taskY + 70);
      doc.text(`£${totalAmount}`, 450, taskY + 70);
      
      // Payment info
      const paymentY = taskY + 120;
      doc.fontSize(12).text('PAYMENT INFORMATION:', 50, paymentY);
      doc.fontSize(10).text(`Account Name: ${formData.accountName || formData.name}`, 50, paymentY + 20);
      doc.text(`Account Number: ${formData.accountNumber || ''}`, 50, paymentY + 35);
      doc.text(`Sort Code: ${formData.sortCode || ''}`, 50, paymentY + 50);
      
      if (isVatRegistered && formData.vatNumber) {
        doc.text(`VAT Number: ${formData.vatNumber}`, 50, paymentY + 70);
      } else if (!isVatRegistered) {
        doc.text('*Not VAT registered, VAT not applicable', 50, paymentY + 70);
      }
      
      doc.end();
      
    } catch (error) {
      reject(error);
    }
  });
}

// Convert file to base64 data URL for temporary storage
function fileToDataURL(file) {
  const base64 = file.content.toString('base64');
  const mimeType = file.contentType || 'image/png';
  return `data:${mimeType};base64,${base64}`;
}

exports.handler = async (event, context) => {
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
    
    // Extract form data
    let formData;
    if (result.data) {
      formData = JSON.parse(result.data);
    } else if (result.fields && result.fields.data) {
      formData = JSON.parse(result.fields.data);
    } else {
      formData = JSON.parse(event.body);
    }

    console.log('Form data parsed successfully');

    // Build invoice title
    const submitterName = formData.name || 'New Submission';
    const invoicePeriod = formData.period || new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const invoiceTypeText = formData.invoiceType === 'retainer' ? 'Monthly Retainer' : 'Rewards Campaign';
    const invoiceTitle = `${submitterName} - ${invoiceTypeText} - ${invoicePeriod}`;

    // Generate PDF invoice if method is 'generate'
    let invoiceInfo = null;
    if (formData.invoiceMethod === 'generate' && formData.invoiceType === 'retainer' && formData.selectedTier) {
      console.log('Generating PDF invoice...');
      try {
        invoiceInfo = await generateInvoicePDF(formData);
        console.log('PDF generated successfully:', invoiceInfo.filename);
      } catch (pdfError) {
        console.error('PDF generation failed:', pdfError);
        // Continue without PDF - will note in Notion
      }
    }

    // Build Notion properties
    const properties = {
      'Invoice Title': {
        title: [{ text: { content: invoiceTitle } }]
      },
      'Status': {
        status: { name: 'Pending' }
      }
    };

    // Add all form fields
    if (formData.email) properties['Email'] = { email: formData.email };
    if (formData.name) properties['Name 1'] = { rich_text: [{ text: { content: formData.name } }] };
    if (formData.discord) properties['Discord Username'] = { rich_text: [{ text: { content: formData.discord } }] };
    if (formData.phone) properties['Phone'] = { phone_number: formData.phone };
    
    if (formData.submissionType) {
      properties['Submission Type'] = {
        select: { name: formData.submissionType === 'individual' ? 'Individual' : 'Business' }
      };
    }

    properties['Brand 1'] = { select: { name: 'Dr Dent' } };

    if (formData.invoiceType) {
      properties['Invoice Type'] = {
        select: { name: formData.invoiceType === 'retainer' ? 'Monthly Retainer' : 'Rewards' }
      };
    }

    if (formData.period) properties['Period'] = { select: { name: formData.period } };

    if (formData.selectedTier) {
      const tierMap = { 'tier1': 'Tier 1', 'tier2': 'Tier 2', 'tier3': 'Tier 3', 'tier4': 'Tier 4' };
      properties['Selected Tier'] = { select: { name: tierMap[formData.selectedTier] } };
    }

    if (formData.accounts && formData.accounts.length > 0) {
      properties['TikTok Handle'] = {
        rich_text: [{ text: { content: formData.accounts.map(acc => acc.handle).join(', ') } }]
      };
    }

    if (formData.address) {
      properties['Address'] = { rich_text: [{ text: { content: formData.address } }] };
    }

    // Bank details
    if (formData.bankName || formData.accountName || formData.accountNumber || formData.sortCode) {
      const bankDetails = [];
      if (formData.bankName) bankDetails.push(`Bank: ${formData.bankName}`);
      if (formData.accountName) bankDetails.push(`Account: ${formData.accountName}`);
      if (formData.accountNumber) bankDetails.push(`Number: ${formData.accountNumber}`);
      if (formData.sortCode) bankDetails.push(`Sort: ${formData.sortCode}`);
      
      properties['Bank Details'] = {
        rich_text: [{ text: { content: bankDetails.join(', ') } }]
      };
    }

    // VAT information
    if (formData.submissionType === 'business' && formData.vatRegistered) {
      properties['VAT Status'] = {
        select: { name: formData.vatRegistered === 'yes' ? 'VAT Registered' : 'Not VAT Registered' }
      };
      
      if (formData.vatNumber) {
        properties['VAT Number'] = { rich_text: [{ text: { content: formData.vatNumber } }] };
      }
    }

    properties['Due Date'] = {
      date: { start: new Date().toISOString().split('T')[0] }
    };

    // Handle screenshot files
    const files = result.files || [];
    if (files.length > 0) {
      console.log(`Processing ${files.length} screenshot files...`);
      
      // For now, we'll create data URLs as temporary links
      // In production, you'd upload to S3/Cloudinary and get real URLs
      const screenshotLinks = files.map((file, index) => {
        const dataURL = fileToDataURL(file);
        return `Screenshot ${index + 1}: ${file.filename}\nData URL: ${dataURL.substring(0, 100)}... (truncated for display)\n`;
      }).join('\n');
      
      properties['Screenshots'] = {
        rich_text: [{ text: { content: `${files.length} screenshots uploaded:\n\n${screenshotLinks}` } }]
      };
    }

    // Add invoice file if generated
    if (invoiceInfo) {
      // Convert PDF to base64 for temporary storage
      const pdfBase64 = invoiceInfo.buffer.toString('base64');
      const pdfDataURL = `data:application/pdf;base64,${pdfBase64}`;
      
      properties['Invoice'] = {
        rich_text: [{
          text: {
            content: `PDF Invoice Generated: ${invoiceInfo.filename}\nDownload: ${pdfDataURL.substring(0, 100)}... (base64 PDF data)`
          }
        }]
      };
    }

    // Create Notion page
    console.log('Creating Notion page...');
    const response = await notion.pages.create({
      parent: { type: "database_id", database_id: DATABASE_ID },
      properties: properties
    });

    console.log('Notion page created successfully:', response.id);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({
        success: true,
        message: 'Invoice submitted successfully',
        notionPageId: response.id,
        invoiceTitle: invoiceTitle,
        invoiceGenerated: !!invoiceInfo,
        filesUploaded: files.length,
        invoiceDownload: invoiceInfo ? `data:application/pdf;base64,${invoiceInfo.buffer.toString('base64')}` : null
      })
    };

  } catch (error) {
    console.error('Error processing submission:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to submit invoice'
      })
    };
  }
};
