// netlify/functions/submit-invoice.js
const { Client } = require('@notionhq/client');
const multipart = require('lambda-multipart-parser');
const PDFDocument = require('pdfkit');
const { google } = require('googleapis');
const stream = require('stream');

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Configure Google Drive and Google Sheets
let drive = null;
let sheets = null;
let googleDriveAuth = null;

async function initializeGoogleDrive() {
  try {
    if (!process.env.GOOGLE_DRIVE_CREDENTIALS_JSON && !process.env.GOOGLE_DRIVE_CREDENTIALS_PATH) {
      console.warn('Warning: Google Drive not configured. Files will not be uploaded to Google Drive.');
      return;
    }

    let credentials;
    if (process.env.GOOGLE_DRIVE_CREDENTIALS_JSON) {
      // For Netlify: credentials stored as JSON string in environment variable
      credentials = JSON.parse(process.env.GOOGLE_DRIVE_CREDENTIALS_JSON);
    } else {
      // For local development: read from file
      const fs = require('fs').promises;
      const path = require('path');
      const credentialsPath = path.resolve(process.env.GOOGLE_DRIVE_CREDENTIALS_PATH);
      credentials = JSON.parse(await fs.readFile(credentialsPath, 'utf8'));
    }

    googleDriveAuth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/spreadsheets'
      ]
    });

    drive = google.drive({ version: 'v3', auth: googleDriveAuth });
    sheets = google.sheets({ version: 'v4', auth: googleDriveAuth });
    console.log('✅ Google Drive configured successfully');
    console.log('✅ Google Sheets configured successfully');
  } catch (error) {
    console.error('Error initializing Google Drive:', error.message);
  }
}

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
      'tier1': { name: '1st Tier', gmvRange: '5-10k', amount: 450, videos: 15 },
      'tier2': { name: '2nd Tier', gmvRange: '£10k - £25k', amount: 600, videos: 15 },
      'tier3': { name: '3rd Tier', gmvRange: '£25k - £50k', amount: 850, videos: 10 },
      'tier4': { name: '4th Tier', gmvRange: '£50k+', amount: 1000, videos: 10 },
      'tier0-1': { name: 'Entry Tier 1', gmvRange: '5-10k overall', amount: 300, videos: 20 },
      'tier0-2': { name: 'Entry Tier 2', gmvRange: '10k-20k overall', amount: 300, videos: 15 },
      'tier0-3': { name: 'Entry Tier 3', gmvRange: '20k+ overall', amount: 400, videos: 15 }
    }
  }
};

function getBrandConfig(brandKey) {
  return BRAND_CONFIGS[brandKey] || BRAND_CONFIGS['dr-dent'];
}

// Find or create a folder in Google Drive
async function findOrCreateFolder(folderName, parentFolderId) {
  if (!drive) throw new Error('Google Drive not initialized');

  try {
    const isSharedDrive = process.env.GOOGLE_DRIVE_IS_SHARED_DRIVE === 'true';

    // Search for existing folder
    const response = await drive.files.list({
      q: `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
      supportsAllDrives: isSharedDrive,
      includeItemsFromAllDrives: isSharedDrive
    });

    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0].id;
    }

    // Create folder if not exists
    const folderMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId]
    };

    const folder = await drive.files.create({
      resource: folderMetadata,
      fields: 'id, name',
      supportsAllDrives: isSharedDrive
    });

    return folder.data.id;
  } catch (error) {
    console.error(`Error finding/creating folder ${folderName}:`, error.message);
    throw error;
  }
}

// Upload file to Google Drive with organized folder structure
async function uploadToGoogleDrive(buffer, filename, brand, month, type, mimeType = 'application/pdf') {
  if (!drive) {
    throw new Error('Google Drive not initialized. Files cannot be uploaded.');
  }

  try {
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!rootFolderId) {
      throw new Error('GOOGLE_DRIVE_FOLDER_ID not configured');
    }

    // Create folder structure: Brand / Invoices / Month / Type
    const brandFolderId = await findOrCreateFolder(brand, rootFolderId);
    const invoicesFolderId = await findOrCreateFolder('Invoices', brandFolderId);
    const monthFolderId = await findOrCreateFolder(month, invoicesFolderId);
    const typeFolderId = await findOrCreateFolder(type, monthFolderId);

    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);

    const fileMetadata = {
      name: filename,
      parents: [typeFolderId]
    };

    const media = {
      mimeType: mimeType,
      body: bufferStream
    };

    const isSharedDrive = process.env.GOOGLE_DRIVE_IS_SHARED_DRIVE === 'true';

    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink, webContentLink',
      supportsAllDrives: isSharedDrive
    });

    // Make file publicly readable
    await drive.permissions.create({
      fileId: file.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      },
      supportsAllDrives: isSharedDrive
    });

    return {
      fileId: file.data.id,
      url: file.data.webViewLink,
      downloadUrl: file.data.webContentLink,
      filename: filename,
      folder: `${brand}/${month}/${type}`
    };
  } catch (error) {
    console.error('Error uploading to Google Drive:', error.message);
    throw error;
  }
}

// Google Sheets Helper Functions

// Find or create a monthly spreadsheet for invoice responses
async function findOrCreateMonthlySpreadsheet(brand, month, year, invoiceType) {
  if (!sheets || !drive) {
    throw new Error('Google Sheets/Drive not initialized');
  }

  // Spreadsheet name without brand prefix (since it's inside the brand folder)
  const spreadsheetName = `${invoiceType} Invoice Submission ${month} ${year} (Responses)`;
  const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const isSharedDrive = process.env.GOOGLE_DRIVE_IS_SHARED_DRIVE === 'true';

  try {
    // Create brand folder first, spreadsheets go inside it
    const brandFolderId = await findOrCreateFolder(brand, rootFolderId);

    // Search for existing spreadsheet in the brand folder
    const searchQuery = `name='${spreadsheetName}' and '${brandFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;

    const searchResponse = await drive.files.list({
      q: searchQuery,
      fields: 'files(id, name)',
      spaces: 'drive',
      supportsAllDrives: isSharedDrive,
      includeItemsFromAllDrives: isSharedDrive
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      console.log(`📊 Found existing spreadsheet: ${spreadsheetName}`);
      return searchResponse.data.files[0].id;
    }

    // Create new spreadsheet directly in the brand folder using Drive API
    console.log(`📊 Creating new spreadsheet: ${spreadsheetName}`);

    const fileMetadata = {
      name: spreadsheetName,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [brandFolderId]
    };

    const createdFile = await drive.files.create({
      resource: fileMetadata,
      fields: 'id',
      supportsAllDrives: isSharedDrive
    });

    const spreadsheetId = createdFile.data.id;
    console.log(`   Created spreadsheet with ID: ${spreadsheetId}`);

    // Rename the default sheet from "Sheet1" to "Responses"
    const spreadsheetInfo = await sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId
    });
    const defaultSheetId = spreadsheetInfo.data.sheets[0].properties.sheetId;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId,
      resource: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: defaultSheetId,
                title: 'Responses'
              },
              fields: 'title'
            }
          }
        ]
      }
    });

    // Add headers to the spreadsheet
    const headers = [
      'Timestamp',
      'Name',
      'Email',
      'Discord',
      'TikTok Account(s)',
      'GMV Generated (Previous Period)',
      'No. of Videos Posted During Period',
      'Retainer Tier',
      'Invoice Amount',
      'Invoice PDF',
      'Screenshots',
      'Submission Type',
      'VAT Status',
      'Address',
      'Bank Details'
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: 'Responses!A1:O1',
      valueInputOption: 'RAW',
      resource: {
        values: [headers]
      }
    });

    // Format header row (bold)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId,
      resource: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: defaultSheetId,
                startRowIndex: 0,
                endRowIndex: 1
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
          },
          {
            updateSheetProperties: {
              properties: {
                sheetId: defaultSheetId,
                gridProperties: {
                  frozenRowCount: 1
                }
              },
              fields: 'gridProperties.frozenRowCount'
            }
          }
        ]
      }
    });

    // Make spreadsheet accessible with link
    await drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: {
        role: 'writer',
        type: 'anyone'
      },
      supportsAllDrives: isSharedDrive
    });

    console.log(`✅ Created spreadsheet: ${spreadsheetName}`);
    return spreadsheetId;

  } catch (error) {
    console.error('Error finding/creating spreadsheet:', error.message);
    throw error;
  }
}

// Append a submission row to the monthly spreadsheet
async function appendToMonthlySpreadsheet(formData, invoiceUrl, screenshotUrls) {
  if (!sheets) {
    throw new Error('Google Sheets not initialized');
  }

  try {
    // Parse month and year from formData.period (e.g., "November 2024")
    const periodParts = formData.period ? formData.period.split(' ') : [];
    const month = periodParts[0] || new Date().toLocaleDateString('en-US', { month: 'long' });
    const year = periodParts[1] || new Date().getFullYear().toString();

    const brand = formData.brand === 'dr-dent' ? 'Dr Dent' : (formData.brand || 'Dr Dent');
    const invoiceType = formData.invoiceType === 'retainer' ? 'Retainer' : 'Rewards';

    // Find or create the monthly spreadsheet
    const spreadsheetId = await findOrCreateMonthlySpreadsheet(brand, month, year, invoiceType);

    // Get tier info
    const brandConfig = getBrandConfig(formData.brand || 'dr-dent');
    const tierInfo = brandConfig.retainerTiers[formData.selectedTier];
    const tierDisplay = tierInfo
      ? `${tierInfo.name} £${tierInfo.amount} ${tierInfo.videos} videos (${tierInfo.gmvRange} Dr Dent GMV)`
      : formData.selectedTier || 'N/A';

    // Calculate invoice amount
    let invoiceAmount = 'N/A';
    if (formData.invoiceType === 'rewards' && formData.rewardAmount) {
      invoiceAmount = `£${formData.rewardAmount}`;
    } else if (tierInfo) {
      invoiceAmount = `£${tierInfo.amount}`;
    }

    // Format TikTok accounts
    const tiktokAccounts = formData.accounts && formData.accounts.length > 0
      ? formData.accounts.map(acc => acc.handle).join(', ')
      : 'N/A';

    // Format screenshots URLs
    const screenshotsStr = screenshotUrls && screenshotUrls.length > 0
      ? screenshotUrls.map(s => s.driveUrl || s.url).join(', ')
      : 'N/A';

    // Format bank details
    const bankDetails = formData.accountName
      ? `${formData.accountName}, Acc: ${formData.accountNumber || 'N/A'}, Sort: ${formData.sortCode || 'N/A'}`
      : 'N/A';

    // Format VAT status
    let vatStatus = 'N/A';
    if (formData.submissionType === 'business') {
      vatStatus = formData.vatRegistered === 'yes'
        ? `VAT Registered (${formData.vatNumber || 'No VAT Number'})`
        : 'Not VAT Registered';
    }

    // Prepare row data
    const timestamp = new Date().toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    // Determine GMV to display (use retainerGmv for retainers, declaredGmv for rewards)
    let gmvDisplay = 'N/A';
    if (formData.invoiceType === 'retainer' && formData.retainerGmv) {
      gmvDisplay = `£${formData.retainerGmv}`;
    } else if (formData.declaredGmv) {
      gmvDisplay = `£${formData.declaredGmv}`;
    }

    // Determine video count to display
    let videoCountDisplay = 'N/A';
    if (formData.firstTimeRetainer) {
      videoCountDisplay = 'N/A (New Creator)';
    } else if (formData.invoiceType === 'retainer' && formData.videoCount) {
      videoCountDisplay = formData.videoCount;
    } else if (formData.invoiceType === 'rewards' && formData.rewardsVideoCount) {
      videoCountDisplay = formData.rewardsVideoCount;
    }

    const rowData = [
      timestamp,
      formData.name || 'N/A',
      formData.email || 'N/A',
      formData.discord || 'N/A',
      tiktokAccounts,
      gmvDisplay,
      videoCountDisplay,
      tierDisplay,
      invoiceAmount,
      invoiceUrl || 'N/A',
      screenshotsStr,
      formData.submissionType === 'individual' ? 'Individual' : 'Business',
      vatStatus,
      formData.address || 'N/A',
      bankDetails
    ];

    // Append the row
    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: 'Responses!A:O',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: [rowData]
      }
    });

    console.log(`✅ Appended submission to spreadsheet for ${month} ${year}`);
    return {
      spreadsheetId,
      month,
      year,
      brand,
      invoiceType
    };

  } catch (error) {
    console.error('Error appending to spreadsheet:', error.message);
    throw error;
  }
}

// Upload file to Cloudinary and return public URL (kept as fallback)
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
      
      // Calculate amount based on invoice type
      let netAmount;
      if (formData.invoiceType === 'retainer') {
        netAmount = brandConfig.retainerTiers[formData.selectedTier]?.amount || 450;
      } else {
        // For rewards, use the provided amount
        netAmount = parseFloat(formData.rewardAmount) || 0;
      }
      
      // VAT calculation
      const isVatRegistered = formData.submissionType === 'business' && formData.vatRegistered === 'yes';
      const vatRate = 0.20;
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
      
      // Task text based on invoice type
      let taskText;
      if (formData.invoiceType === 'retainer') {
        taskText = `Monthly retainer for ${brandConfig.displayName} - ${formData.period}`;
      } else {
        taskText = formData.period; // This is the "Reward Claimed" text
      }
      
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
    // Initialize Google Drive
    await initializeGoogleDrive();

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

    // Prepare folder organization variables
    const brandName = formData.brand || 'Dr Dent';
    const brandDisplayName = brandName.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase());

    const now = new Date();
    const monthName = now.toLocaleDateString('en-US', { month: 'long' });
    const monthFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')} ${monthName}`;

    const invoiceType = formData.invoiceType === 'retainer' ? 'Retainers' : 'Rewards';

    // Generate and upload PDF
    let invoiceInfo = null;
    if (formData.invoiceMethod === 'generate') {
      if ((formData.invoiceType === 'retainer' && formData.selectedTier) ||
          (formData.invoiceType === 'rewards' && formData.rewardAmount)) {
        try {
          const pdfResult = await generateInvoicePDF(formData);

          // Upload to Google Drive
          try {
            const driveResult = await uploadToGoogleDrive(
              pdfResult.buffer,
              pdfResult.filename,
              brandDisplayName,
              monthFolder,
              invoiceType,
              'application/pdf'
            );

            invoiceInfo = {
              ...pdfResult,
              driveUrl: driveResult.url,
              driveFileId: driveResult.fileId,
              driveFolder: driveResult.folder
            };
          } catch (uploadError) {
            console.error('Failed to upload invoice to Google Drive:', uploadError);
            invoiceInfo = pdfResult;
          }
        } catch (pdfError) {
          console.error('PDF generation failed:', pdfError);
        }
      }
    }

    // Upload screenshots and invoice files
    const files = result.files || [];
    const screenshotInfo = [];
    let uploadedInvoiceInfo = null;

    if (files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          // Check if this is an uploaded invoice file
          const isPDF = file.contentType === 'application/pdf' || file.filename.toLowerCase().endsWith('.pdf');
          const isInvoiceField = file.fieldname === 'invoiceFileInput';

          if (isPDF || isInvoiceField) {
            // This is an uploaded invoice
            const timestamp = Date.now();
            const invoiceFilename = `uploaded-invoice-${timestamp}-${file.filename}`;

            try {
              const driveResult = await uploadToGoogleDrive(
                file.content,
                invoiceFilename,
                brandDisplayName,
                monthFolder,
                invoiceType,
                'application/pdf'
              );

              uploadedInvoiceInfo = {
                filename: file.filename,
                driveUrl: driveResult.url,
                driveFileId: driveResult.fileId,
                driveFolder: driveResult.folder
              };
            } catch (uploadError) {
              console.error('Failed to upload invoice to Google Drive:', uploadError);
            }
          } else {
            // This is a screenshot
            const timestamp = Date.now();
            const screenshotFilename = `screenshot-${timestamp}-${i}-${file.filename}`;

            try {
              const driveResult = await uploadToGoogleDrive(
                file.content,
                screenshotFilename,
                brandDisplayName,
                monthFolder,
                `${invoiceType}/Screenshots`,
                file.contentType || 'image/png'
              );

              screenshotInfo.push({
                originalName: file.filename,
                driveUrl: driveResult.url,
                driveFileId: driveResult.fileId,
                driveFolder: driveResult.folder
              });
            } catch (uploadError) {
              console.error(`Failed to upload screenshot ${i + 1}:`, uploadError);
            }
          }
        } catch (uploadError) {
          console.error(`Failed to process file ${i + 1}:`, uploadError);
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
      const tierMap = {
        'tier1': 'Tier 1',
        'tier2': 'Tier 2',
        'tier3': 'Tier 3',
        'tier4': 'Tier 4',
        'tier0-1': 'Entry Tier 1',
        'tier0-2': 'Entry Tier 2',
        'tier0-3': 'Entry Tier 3'
      };
      properties['Selected Tier'] = { select: { name: tierMap[formData.selectedTier] } };
    }

    // Add first time retainer checkbox
    if (formData.firstTimeRetainer !== undefined) {
      properties['First Time Retainer'] = { checkbox: formData.firstTimeRetainer };
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

    // Add invoice file (either generated or uploaded)
    if (invoiceInfo && invoiceInfo.driveUrl) {
      // Generated invoice from Google Drive
      properties['Invoice'] = {
        files: [{
          name: invoiceInfo.filename,
          external: { url: invoiceInfo.driveUrl }
        }]
      };
    } else if (uploadedInvoiceInfo && uploadedInvoiceInfo.driveUrl) {
      // Uploaded invoice from Google Drive
      properties['Invoice'] = {
        files: [{
          name: uploadedInvoiceInfo.filename,
          external: { url: uploadedInvoiceInfo.driveUrl }
        }]
      };
    }

    // Add screenshots from Google Drive
    if (screenshotInfo.length > 0) {
      properties['Screenshots'] = { url: screenshotInfo[0].driveUrl };
    }

    // Add submission to Google Sheets
    let sheetResult = null;
    const invoiceUrl = invoiceInfo?.driveUrl || uploadedInvoiceInfo?.driveUrl || null;

    try {
      sheetResult = await appendToMonthlySpreadsheet(formData, invoiceUrl, screenshotInfo);
      console.log(`✅ Added to Google Sheet: ${sheetResult.brand} ${sheetResult.invoiceType} - ${sheetResult.month} ${sheetResult.year}`);
    } catch (sheetError) {
      console.error('Failed to add to Google Sheet:', sheetError.message);
      // Continue with Notion submission even if Sheet fails
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
        invoiceUrl: invoiceInfo?.driveUrl || uploadedInvoiceInfo?.driveUrl || null,
        screenshotsUploaded: screenshotInfo.length,
        sheet: sheetResult ? {
          spreadsheetId: sheetResult.spreadsheetId,
          month: sheetResult.month,
          year: sheetResult.year
        } : null
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
