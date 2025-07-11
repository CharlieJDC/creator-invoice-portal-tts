// netlify/functions/submit-invoice.js
const { Client } = require('@notionhq/client');
const multipart = require('lambda-multipart-parser');
const PDFDocument = require('pdfkit');
const cloudinary = require('cloudinary').v2;

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

// Upload file to Cloudinary and return public URL
async function uploadToCloudinary(buffer, filename, resourceType = 'auto') {
  try {
    return new Promise((resolve, reject) => {
      const uploadOptions = {
        resource_type: resourceType,
        public_id: `tmmb-invoices/${Date.now()}-${filename.replace(/\.[^/.]+$/, "")}`,
        use_filename: false,
        unique_filename: false,
        folder: 'tmmb-invoices'
      };

      if (resourceType === 'raw') {
        uploadOptions.flags = 'attachment';
      }

      const uploadStream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result) => {
          if (error) {
            console.error('Cloudinary upload error:', error);
            reject(error);
          } else {
            console.log('Cloudinary upload success:', result.secure_url);
            resolve({
              publicId: result.public_id,
              url: result.secure_url,
              filename: result.original_filename || filename
            });
          }
        }
      );

      uploadStream.end(buffer);
    });
  } catch (error) {
    console.error('Error uploading to Cloudinary:', error);
    throw error;
  }
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
      const doc = new PDFDocument({ margin: 60, size: 'A4' });
      
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
      
      // Invoice title - large, centered, spaced
      doc.fontSize(36)
         .font('Helvetica')
         .text('INVOICE', 60, 120, { align: 'center', characterSpacing: 8 });
      
      // Billed To section (left side) - Brand details
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('BILLED TO:', 60, 200);
      
      doc.fontSize(11)
         .font('Helvetica')
         .text(brandConfig.billingDetails.companyName, 60, 220);
      
      const brandAddressLines = brandConfig.billingDetails.address.split('\n');
      let yPosition = 235;
      brandAddressLines.forEach(line => {
        doc.text(line.trim(), 60, yPosition);
        yPosition += 15;
      });
      
      // From section (right side) - Creator details
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('FROM:', 400, 200);
      
      doc.fontSize(11)
         .font('Helvetica')
         .text(formData.name, 400, 220);
      
      if (formData.address) {
        const creatorAddressLines = formData.address.split('\n');
        let creatorYPosition = 235;
        creatorAddressLines.forEach(line => {
          doc.text(line.trim(), 400, creatorYPosition);
          creatorYPosition += 15;
        });
      }
      
      // Date section
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('DATE:', 400, 300);
      
      doc.fontSize(11)
         .font('Helvetica')
         .text(new Date().toLocaleDateString('en-GB', { 
           day: 'numeric', 
           month: 'long', 
           year: 'numeric' 
         }), 400, 320);
      
      // Task section
      const taskY = 380;
      
      doc.moveTo(60, taskY - 10)
         .lineTo(535, taskY - 10)
         .stroke();
      
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('TASK', 60, taskY)
         .text('TOTAL', 450, taskY);
      
      const taskText = formData.invoiceType === 'retainer' ? 
        `Monthly retainer for ${brandConfig.displayName} - ${formData.period}` : 
        `${formData.period} campaign`;
      
      doc.fontSize(11)
         .font('Helvetica')
         .text(taskText, 60, taskY + 25)
         .text(`£${netAmount}`, 450, taskY + 25);
      
      let currentY = taskY + 45;
      
      if (isVatRegistered) {
        doc.text('VAT (20%)', 60, currentY)
           .text(`£${vatAmount}`, 450, currentY);
        currentY += 20;
      }
      
      doc.moveTo(60, currentY + 10)
         .lineTo(535, currentY + 10)
         .stroke();
      
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .text('TOTAL DUE', 350, currentY + 25)
         .text(`£${totalAmount}`, 450, currentY + 25);
      
      // Payment information
      const paymentY = currentY + 80;
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('PAYMENT INFORMATION:', 60, paymentY);
      
      doc.fontSize(11)
         .font('Helvetica')
         .text(`Account Name: ${formData.accountName || formData.name}`, 60, paymentY + 25)
         .text(`Account Number: ${formData.accountNumber || ''}`, 60, paymentY + 45)
         .text(`Sort Code: ${formData.sortCode || ''}`, 60, paymentY + 65);
      
      if (isVatRegistered && formData.vatNumber) {
        doc.fontSize(10)
           .font('Helvetica-Oblique')
           .text(`VAT Number: ${formData.vatNumber}`, 60, paymentY + 100);
      } else if (!isVatRegistered) {
        doc.fontSize(10)
           .font('Helvetica-Oblique')
           .text('*Not VAT registered, VAT not applicable', 60, paymentY + 100);
      }
      
      doc.rect(60, 750, 475, 20)
         .fill('black');
      
      doc.end();
      
    } catch (error) {
      reject(error);
    }
  });
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const result = await multipart.parse(event);
    
    let formData;
    if (result.data) {
      formData = JSON.parse(result.data);
    } else if (result.fields && result.fields.data) {
      formData = JSON.parse(result.fields.data);
    } else {
      formData = JSON.parse(event.body);
    }

    const submitterName = formData.name || 'New Submission';
    const invoicePeriod = formData.period || new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const invoiceTypeText = formData.invoiceType === 'retainer' ? 'Monthly Retainer' : 'Rewards Campaign';
    const invoiceTitle = `${submitterName} - ${invoiceTypeText} - ${invoicePeriod}`;

    // Generate and upload PDF
    let invoiceInfo = null;
    if (formData.invoiceMethod === 'generate' && formData.invoiceType === 'retainer' && formData.selectedTier) {
      try {
        const pdfResult = await generateInvoicePDF(formData);
        const cloudinaryResult = await uploadToCloudinary(pdfResult.buffer, pdfResult.filename, 'raw');
        
        invoiceInfo = {
          ...pdfResult,
          cloudinaryUrl: cloudinaryResult.url,
          publicId: cloudinaryResult.publicId
        };
      } catch (pdfError) {
        console.error('PDF generation failed:', pdfError);
      }
    }

    // Upload screenshots
    const files = result.files || [];
    const screenshotInfo = [];
    
    if (files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const timestamp = Date.now();
          const screenshotFilename = `screenshot-${timestamp}-${i}-${file.filename}`;
          
          const cloudinaryResult = await uploadToCloudinary(file.content, screenshotFilename, 'image');
          
          screenshotInfo.push({
            originalName: file.filename,
            cloudinaryUrl: cloudinaryResult.url,
            publicId: cloudinaryResult.publicId
          });
        } catch (uploadError) {
          console.error(`Failed to upload screenshot ${i + 1}:`, uploadError);
        }
      }
    }

    // Build properties
    const properties = {
      'Invoice Title': { title: [{ text: { content: invoiceTitle } }] },
      'Status': { status: { name: 'Pending' } }
    };

    if (formData.email) properties['Email'] = { email: formData.email };
    if (formData.name) properties['Name 1'] = { rich_text: [{ text: { content: formData.name } }] };
    if (formData.discord) properties['Discord Username'] = { rich_text: [{ text: { content: formData.discord } }] };
    if (formData.phone) properties['Phone'] = { phone_number: formData.phone };
    
    if (formData.submissionType) {
      properties['Submission Type'] = { select: { name: formData.submissionType === 'individual' ? 'Individual' : 'Business' } };
    }

    properties['Brand 1'] = { select: { name: 'Dr Dent' } };

    if (formData.invoiceType) {
      properties['Invoice Type'] = { select: { name: formData.invoiceType === 'retainer' ? 'Monthly Retainer' : 'Rewards' } };
    }

    if (formData.period) properties['Period'] = { select: { name: formData.period } };

    if (formData.selectedTier) {
      const tierMap = { 'tier1': 'Tier 1', 'tier2': 'Tier 2', 'tier3': 'Tier 3', 'tier4': 'Tier 4' };
      properties['Selected Tier'] = { select: { name: tierMap[formData.selectedTier] } };
    }

    if (formData.accounts && formData.accounts.length > 0) {
      properties['TikTok Handle'] = { rich_text: [{ text: { content: formData.accounts.map(acc => acc.handle).join(', ') } }] };
    }

    if (formData.address) {
      properties['Address'] = { rich_text: [{ text: { content: formData.address } }] };
    }

    if (formData.bankName || formData.accountName || formData.accountNumber || formData.sortCode) {
      const bankDetails = [];
      if (formData.bankName) bankDetails.push(`Bank: ${formData.bankName}`);
      if (formData.accountName) bankDetails.push(`Account: ${formData.accountName}`);
      if (formData.accountNumber) bankDetails.push(`Number: ${formData.accountNumber}`);
      if (formData.sortCode) bankDetails.push(`Sort: ${formData.sortCode}`);
      
      properties['Bank Details'] = { rich_text: [{ text: { content: bankDetails.join(', ') } }] };
    }

    if (formData.submissionType === 'business' && formData.vatRegistered) {
      properties['VAT Status'] = { select: { name: formData.vatRegistered === 'yes' ? 'VAT Registered' : 'Not VAT Registered' } };
      
      if (formData.vatNumber) {
        properties['VAT Number'] = { rich_text: [{ text: { content: formData.vatNumber } }] };
      }
    }

    properties['Submitted on'] = { date: { start: new Date().toISOString().split('T')[0] } };

    // Add invoice file
    if (invoiceInfo && invoiceInfo.cloudinaryUrl) {
      properties['Invoice'] = {
        files: [{
          name: invoiceInfo.filename,
          external: { url: invoiceInfo.cloudinaryUrl }
        }]
      };
    }

    // Add screenshots
    if (screenshotInfo.length > 0) {
      properties['Screenshots'] = { url: screenshotInfo[0].cloudinaryUrl };
      
      if (screenshotInfo.length > 1) {
        const screenshotLinks = screenshotInfo.map((screenshot, index) => 
          `📷 Screenshot ${index + 1}: ${screenshot.cloudinaryUrl}`
        ).join('\n');
        
        properties['Screenshot Links'] = { rich_text: [{ text: { content: screenshotLinks } }] };
      }
    }

    const response = await notion.pages.create({
      parent: { type: "database_id", database_id: DATABASE_ID },
      properties: properties
    });

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
        invoiceUrl: invoiceInfo?.cloudinaryUrl || null,
        screenshotsUploaded: screenshotInfo.length,
        screenshotUrls: screenshotInfo.map(s => s.cloudinaryUrl)
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
