// server.js - Node.js Express Backend
const express = require('express');
const multer = require('multer');
const { Client } = require('@notionhq/client');
const cors = require('cors');
const path = require('path');
const puppeteer = require('puppeteer');
const handlebars = require('handlebars');
const fs = require('fs').promises;
const cloudinary = require('cloudinary').v2;
const { google } = require('googleapis');
const stream = require('stream');
require('dotenv').config();

// Configure Cloudinary
// CLOUDINARY_URL format: cloudinary://API_KEY:API_SECRET@CLOUD_NAME
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({
    cloudinary_url: process.env.CLOUDINARY_URL
  });
  console.log('Cloudinary configured successfully');
} else {
  console.warn('Warning: CLOUDINARY_URL not set. File uploads will fail.');
}

// Configure Google Drive and Google Sheets
let drive = null;
let sheets = null;
let googleDriveAuth = null;

async function initializeGoogleDrive() {
  try {
    if (!process.env.GOOGLE_DRIVE_CREDENTIALS_PATH || !process.env.GOOGLE_DRIVE_FOLDER_ID) {
      console.warn('Warning: Google Drive not configured. Set GOOGLE_DRIVE_CREDENTIALS_PATH and GOOGLE_DRIVE_FOLDER_ID');
      return;
    }

    const credentialsPath = path.resolve(process.env.GOOGLE_DRIVE_CREDENTIALS_PATH);
    const credentials = JSON.parse(await fs.readFile(credentialsPath, 'utf8'));

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
    console.log('   Service Account:', credentials.client_email);
    console.log('   Root Folder ID:', process.env.GOOGLE_DRIVE_FOLDER_ID);
  } catch (error) {
    console.error('Error initializing Google Drive:', error.message);
    console.warn('Google Drive uploads will not be available');
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_TOKEN, // Your integration token
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID; // Your database ID

// Brand configurations - easily expandable
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
    },
    rewardsStructure: {
      baseRate: 0.05, // 5% commission
      bonusThresholds: [
        { threshold: 1000, bonus: 0.01 }, // Extra 1% over £1k
        { threshold: 5000, bonus: 0.015 } // Extra 1.5% over £5k
      ]
    },
    colors: {
      primary: '#ef4444',
      secondary: '#1e293b'
    }
  },
  
  // Example of how to add future brands
  'future-brand': {
    name: 'future-brand',
    displayName: 'Future Brand',
    billingDetails: {
      companyName: 'Future Brand Ltd',
      address: `123 Future Street
London
E1 6AN
GB`,
      email: 'billing@futurebrand.com',
      phone: '+44 xxx xxx xxxx'
    },
    retainerTiers: {
      'tier1': { name: 'Bronze', gmvRange: '<£5k', amount: 300 },
      'tier2': { name: 'Silver', gmvRange: '£5k - £15k', amount: 500 },
      'tier3': { name: 'Gold', gmvRange: '£15k - £30k', amount: 750 },
      'tier4': { name: 'Platinum', gmvRange: '£30k+', amount: 1200 }
    },
    rewardsStructure: {
      baseRate: 0.06, // 6% commission
      bonusThresholds: [
        { threshold: 2000, bonus: 0.02 }
      ]
    },
    colors: {
      primary: '#3b82f6',
      secondary: '#1f2937'
    }
  }
};

// Helper function to get brand config
function getBrandConfig(brandKey) {
  return BRAND_CONFIGS[brandKey] || BRAND_CONFIGS['dr-dent']; // Default to Dr Dent
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

// Google Drive Helper Functions

// Find or create a folder in Google Drive
async function findOrCreateFolder(folderName, parentFolderId) {
  if (!drive) {
    throw new Error('Google Drive not initialized');
  }

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
      console.log(`  Found existing folder: ${folderName}`);
      return response.data.files[0].id;
    }

    // Create new folder if it doesn't exist
    console.log(`  Creating new folder: ${folderName}`);
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
    throw new Error('Google Drive not initialized. Check your credentials.');
  }

  try {
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    console.log(`📁 Organizing file in Google Drive:`);
    console.log(`   Brand: ${brand}, Month: ${month}, Type: ${type}`);

    // Create folder structure: Invoices / Brand / Month / Type
    const invoicesFolderId = await findOrCreateFolder('Invoices', rootFolderId);
    const brandFolderId = await findOrCreateFolder(brand, invoicesFolderId);
    const monthFolderId = await findOrCreateFolder(month, brandFolderId);
    const typeFolderId = await findOrCreateFolder(type, monthFolderId);

    // Upload file
    console.log(`   Uploading: ${filename}`);

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

    // Make file accessible with link
    await drive.permissions.create({
      fileId: file.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      },
      supportsAllDrives: isSharedDrive
    });

    const fileUrl = file.data.webViewLink;
    console.log(`✅ Uploaded to Google Drive: ${fileUrl}`);

    return {
      fileId: file.data.id,
      url: fileUrl,
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

  const spreadsheetName = `${brand} ${invoiceType} Invoice Submission ${month} ${year} (Responses)`;
  const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const isSharedDrive = process.env.GOOGLE_DRIVE_IS_SHARED_DRIVE === 'true';

  try {
    // Search for existing spreadsheet in the folder
    const searchQuery = `name='${spreadsheetName}' and '${rootFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;

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

    // Create new spreadsheet directly in the target folder using Drive API
    console.log(`📊 Creating new spreadsheet: ${spreadsheetName}`);

    // For Shared Drives, create the file directly with parent
    const fileMetadata = {
      name: spreadsheetName,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [rootFolderId]
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
                sheetId: 0,
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
                sheetId: 0,
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
      ? screenshotUrls.map(s => s.url).join(', ')
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

    const rowData = [
      timestamp,
      formData.name || 'N/A',
      formData.email || 'N/A',
      formData.discord || 'N/A',
      tiktokAccounts,
      formData.declaredGmv ? `£${formData.declaredGmv}` : 'N/A',
      formData.firstTimeRetainer ? 'N/A (New Creator)' : (formData.videoCount || 'N/A'),
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

// Test database connection on startup
async function testDB() {
  try {
    console.log('Testing database ID:', DATABASE_ID);
    const db = await notion.databases.retrieve({
      database_id: DATABASE_ID
    });
    console.log('✅ Database connected successfully!');
    console.log('Database name:', db.title[0]?.plain_text);
    console.log('Available properties:', Object.keys(db.properties));
  } catch (error) {
    console.log('❌ Database connection failed:', error.message);
  }
}

// Initialize services on startup
async function initializeServices() {
  await testDB();
  await initializeGoogleDrive();
}

initializeServices();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve your HTML form from public folder

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Updated generateInvoice function with brand support and VAT handling
async function generateInvoice(formData) {
  try {
    const brandConfig = getBrandConfig(formData.brand || 'dr-dent');
    
    // Determine the amount based on invoice type
    let amount;
    if (formData.invoiceType === 'rewards' && formData.rewardAmount) {
      amount = parseFloat(formData.rewardAmount);
    } else {
      // For retainers, use tier amount
      amount = brandConfig.retainerTiers[formData.selectedTier]?.amount || 450;
    }
    
    // VAT calculation
    const isVatRegistered = formData.submissionType === 'business' && formData.vatRegistered === 'yes';
    const vatRate = 0.20; // 20% VAT
    const netAmount = amount;
    const vatAmount = isVatRegistered ? Math.round(netAmount * vatRate * 100) / 100 : 0;
    const totalAmount = netAmount + vatAmount;
    
    // Create invoice data
    const invoiceData = {
      invoiceNumber: `${brandConfig.name.toUpperCase()}-${Date.now()}`,
      date: new Date().toLocaleDateString('en-GB', { 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric' 
      }),
      
      // Brand billing details (top of invoice)
      brandDetails: brandConfig.billingDetails,
      
      // Customer details
      billedTo: {
        name: formData.name,
        address: formData.address || 'Address not provided'
      },
      
      // Invoice details
      task: formData.invoiceType === 'retainer' ? 
        `Monthly retainer for ${brandConfig.displayName} - ${formData.period}` : 
        `${formData.period} campaign`,
      
      // Amounts
      netAmount: `£${netAmount}`,
      vatAmount: isVatRegistered ? `£${vatAmount}` : null,
      totalAmount: `£${totalAmount}`,
      
      // Payment details
      accountName: formData.accountName || formData.name,
      accountNumber: formData.accountNumber || '',
      sortCode: formData.sortCode || '',
      
      // VAT details
      isVatRegistered: isVatRegistered,
      vatNumber: isVatRegistered ? (formData.vatNumber || 'VAT Number TBC') : null,
      
      // Brand styling
      brandColors: brandConfig.colors
    };

    // Updated HTML template with brand details and VAT support
    const invoiceTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {
                font-family: Arial, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 40px;
                line-height: 1.6;
                color: #333;
            }
            .brand-header {
                margin-bottom: 40px;
            }
            .brand-name {
                font-size: 24px;
                font-weight: bold;
                color: {{brandColors.primary}};
                margin-bottom: 10px;
            }
            .brand-address {
                font-size: 14px;
                color: #666;
                white-space: pre-line;
            }
            .header {
                text-align: center;
                margin-bottom: 60px;
            }
            .invoice-title {
                font-size: 36px;
                font-weight: normal;
                letter-spacing: 8px;
                margin-bottom: 40px;
            }
            .invoice-details {
                display: flex;
                justify-content: space-between;
                margin-bottom: 60px;
            }
            .billed-to h3, .date h3 {
                font-size: 14px;
                font-weight: bold;
                margin-bottom: 10px;
                letter-spacing: 1px;
            }
            .company-details {
                margin-bottom: 20px;
            }
            .task-section {
                border-top: 1px solid #ddd;
                border-bottom: 1px solid #ddd;
                padding: 30px 0;
                margin: 40px 0;
            }
            .task-header {
                display: flex;
                justify-content: space-between;
                font-weight: bold;
                font-size: 14px;
                letter-spacing: 1px;
                margin-bottom: 20px;
            }
            .task-details {
                display: flex;
                justify-content: space-between;
                margin-bottom: 20px;
            }
            .vat-line {
                display: flex;
                justify-content: space-between;
                margin-bottom: 20px;
                font-size: 14px;
            }
            .total-section {
                text-align: right;
                font-size: 18px;
                font-weight: bold;
                letter-spacing: 1px;
                border-top: 1px solid #ddd;
                padding-top: 15px;
            }
            .payment-info {
                margin-top: 80px;
                margin-bottom: 40px;
            }
            .payment-info h3 {
                font-size: 14px;
                font-weight: bold;
                letter-spacing: 1px;
                margin-bottom: 20px;
            }
            .payment-details {
                margin-bottom: 10px;
            }
            .vat-note {
                font-style: italic;
                margin-top: 30px;
                font-size: 14px;
            }
            .footer {
                position: fixed;
                bottom: 40px;
                left: 40px;
                right: 40px;
                height: 40px;
                background: #000;
            }
        </style>
    </head>
    <body>
        <div class="brand-header">
            <div class="brand-name">{{brandDetails.companyName}}</div>
            <div class="brand-address">{{brandDetails.address}}</div>
        </div>

        <div class="header">
            <div class="invoice-title">INVOICE</div>
        </div>

        <div class="invoice-details">
            <div class="billed-to">
                <h3>BILLED TO:</h3>
                <div class="company-details">
                    <div>{{billedTo.name}}</div>
                    <div style="white-space: pre-line;">{{billedTo.address}}</div>
                </div>
            </div>
            <div class="date">
                <h3>DATE</h3>
                <div>{{date}}</div>
            </div>
        </div>

        <div class="task-section">
            <div class="task-header">
                <span>TASK</span>
                <span>TOTAL</span>
            </div>
            <div class="task-details">
                <span>{{task}}</span>
                <span>{{netAmount}}</span>
            </div>
            {{#if isVatRegistered}}
            <div class="vat-line">
                <span>VAT (20%)</span>
                <span>{{vatAmount}}</span>
            </div>
            {{/if}}
            <div class="total-section">
                <div>TOTAL DUE &nbsp;&nbsp;&nbsp;&nbsp; {{totalAmount}}</div>
            </div>
        </div>

        <div class="payment-info">
            <h3>PAYMENT INFORMATION:</h3>
            <div class="payment-details">
                <strong>Account Name:</strong> &nbsp;&nbsp;&nbsp; {{accountName}}
            </div>
            <div class="payment-details">
                <strong>Account Number:</strong> &nbsp;&nbsp;&nbsp; {{accountNumber}}
            </div>
            <div class="payment-details">
                <strong>Sort Code:</strong> &nbsp;&nbsp;&nbsp; {{sortCode}}
            </div>
            
            {{#if isVatRegistered}}
            <div class="vat-note">
                VAT Number: {{vatNumber}}
            </div>
            {{else}}
            <div class="vat-note">
                *Not VAT registered, VAT not applicable
            </div>
            {{/if}}
        </div>

        <div class="footer"></div>
    </body>
    </html>
    `;

    // Compile the template
    const template = handlebars.compile(invoiceTemplate);
    const html = template(invoiceData);

    // Generate PDF using Puppeteer
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setContent(html);
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '40px',
        bottom: '40px',
        left: '40px',
        right: '40px'
      }
    });

    await browser.close();

    // Save PDF to local file system
    const filename = `invoice-${invoiceData.invoiceNumber}.pdf`;
    const filepath = path.join(__dirname, 'invoices', filename);

    // Create invoices directory if it doesn't exist
    await fs.mkdir(path.join(__dirname, 'invoices'), { recursive: true });

    // Save the PDF file
    await fs.writeFile(filepath, pdfBuffer);

    return {
      pdfBuffer,
      filename,
      filepath,
      invoiceNumber: invoiceData.invoiceNumber
    };

  } catch (error) {
    console.error('Error generating invoice:', error);
    throw error;
  }
}

// API endpoint for form submission
app.post('/api/submit-invoice', upload.any(), async (req, res) => {
  try {
    console.log('Testing database...');
    console.log('Database ID:', DATABASE_ID);

    const dbTest = await notion.databases.retrieve({
      database_id: DATABASE_ID
    });
    console.log('Database found:', dbTest.title);
    console.log('Column names:', Object.keys(dbTest.properties));

    console.log('Received form submission:', req.body);
    
    // Parse the form data
    const formData = JSON.parse(req.body.data);
    const files = req.files || [];

    // Prepare folder organization variables
    const brandName = formData.brand || 'Dr Dent';
    const brandDisplayName = brandName.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase()); // "dr-dent" -> "Dr Dent"

    // Format month as "YYYY-MM MonthName" (e.g., "2025-11 November")
    const now = new Date();
    const monthName = now.toLocaleDateString('en-US', { month: 'long' });
    const monthFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')} ${monthName}`;

    const invoiceType = formData.invoiceType === 'retainer' ? 'Retainers' : 'Rewards';

    // Generate invoice if method is 'generate'
    let invoiceInfo = null;
    if (formData.invoiceMethod === 'generate') {
      console.log('Generating invoice...');
      const generatedInvoice = await generateInvoice(formData);
      console.log('Invoice generated:', generatedInvoice.filename);

      // Upload generated PDF to Google Drive
      try {
        const driveResult = await uploadToGoogleDrive(
          generatedInvoice.pdfBuffer,
          generatedInvoice.filename,
          brandDisplayName,
          monthFolder,
          invoiceType,
          'application/pdf'
        );

        invoiceInfo = {
          ...generatedInvoice,
          driveUrl: driveResult.url,
          driveFileId: driveResult.fileId,
          driveFolder: driveResult.folder
        };

        console.log('Invoice uploaded to Google Drive:', driveResult.url);
      } catch (uploadError) {
        console.error('Failed to upload invoice to Google Drive:', uploadError);
        // Fall back to local file if Google Drive fails
        invoiceInfo = generatedInvoice;
      }
    }

    // Handle uploaded invoice files
    let uploadedInvoiceInfo = null;
    if (formData.invoiceMethod === 'upload') {
      const invoiceFile = files.find(f => f.fieldname === 'invoiceFileInput');
      if (invoiceFile) {
        console.log('Processing uploaded invoice:', invoiceFile.originalname);

        try {
          const timestamp = Date.now();
          const invoiceFilename = `${formData.name.replace(/\s+/g, '-')}_${invoiceType}_${timestamp}.pdf`;

          const driveResult = await uploadToGoogleDrive(
            invoiceFile.buffer,
            invoiceFilename,
            brandDisplayName,
            monthFolder,
            invoiceType,
            'application/pdf'
          );

          uploadedInvoiceInfo = {
            filename: invoiceFile.originalname,
            driveUrl: driveResult.url,
            driveFileId: driveResult.fileId,
            driveFolder: driveResult.folder
          };

          console.log('Uploaded invoice to Google Drive:', driveResult.url);
        } catch (uploadError) {
          console.error('Failed to upload invoice to Google Drive:', uploadError);
        }
      }
    }

    // Build properties object, excluding undefined values
    const properties = {
      // Map form fields to your Notion database properties
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
        'tier4': 'Tier 4',
        'tier0-1': 'Entry Tier 1',
        'tier0-2': 'Entry Tier 2',
        'tier0-3': 'Entry Tier 3'
      };
      properties['Selected Tier'] = {
        select: {
          name: tierMap[formData.selectedTier],
        },
      };
    }

    // Add first time retainer checkbox
    if (formData.firstTimeRetainer !== undefined) {
      properties['First Time Retainer'] = {
        checkbox: formData.firstTimeRetainer
      };
    }

    // Add reward amount for rewards invoices
    if (formData.rewardAmount) {
      properties['Reward Amount'] = {
        number: parseFloat(formData.rewardAmount)
      };
    }

    // Add declared GMV for rewards invoices
    if (formData.declaredGmv) {
      properties['Declared GMV'] = {
        number: parseFloat(formData.declaredGmv)
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

    // Note: Using 'Date Paid' property instead of 'Due Date' since that's what exists in the database
    // Commenting out for now as this should be set when payment is made, not on submission
    // properties['Date Paid'] = {
    //   date: {
    //     start: new Date().toISOString().split('T')[0],
    //   },
    // };

    // Handle screenshot files - upload to Google Drive and add to Notion
    const screenshotUrls = [];

    if (files.length > 0) {
      console.log(`Received ${files.length} screenshot files`);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const screenshotFilename = `${formData.name.replace(/\s+/g, '-')}_screenshot_${i + 1}_${Date.now()}.${file.originalname.split('.').pop()}`;

        try {
          // Upload to Google Drive in Screenshots subfolder
          const driveResult = await uploadToGoogleDrive(
            file.buffer,
            screenshotFilename,
            brandDisplayName,
            monthFolder,
            `${invoiceType}/Screenshots`, // Nested folder: Retainers/Screenshots or Rewards/Screenshots
            file.mimetype || 'image/png'
          );

          screenshotUrls.push({
            name: file.originalname,
            url: driveResult.url,
            fileId: driveResult.fileId,
            folder: driveResult.folder
          });

          console.log(`Uploaded screenshot to Google Drive: ${driveResult.url}`);
        } catch (uploadError) {
          console.error(`Failed to upload screenshot ${i + 1}:`, uploadError);
        }
      }

      // Add screenshots to Notion properties as URL (single URL format)
      if (screenshotUrls.length > 0) {
        console.log('Adding screenshots to Notion as URL:', screenshotUrls);
        // Notion URL field only accepts a single URL, so we'll use the first screenshot
        properties['Screenshots'] = {
          url: screenshotUrls[0].url
        };

        // If there are multiple screenshots, log a warning
        if (screenshotUrls.length > 1) {
          console.warn(`Warning: ${screenshotUrls.length} screenshots uploaded to Google Drive, but only the first one will be stored in Notion URL field`);
          console.log('All uploaded screenshot URLs:', screenshotUrls.map(s => s.url));
        }
      }
    }

    // Add invoice file (either generated or uploaded)
    if (invoiceInfo && invoiceInfo.driveUrl) {
      // Generated invoice with Google Drive URL
      properties['Invoice'] = {
        files: [
          {
            name: invoiceInfo.filename,
            external: {
              url: invoiceInfo.driveUrl
            }
          }
        ]
      };
    } else if (uploadedInvoiceInfo && uploadedInvoiceInfo.driveUrl) {
      // Uploaded invoice with Google Drive URL
      properties['Invoice'] = {
        files: [
          {
            name: uploadedInvoiceInfo.filename,
            external: {
              url: uploadedInvoiceInfo.driveUrl
            }
          }
        ]
      };
    } else if (invoiceInfo) {
      // Fallback to local URL (shouldn't happen with Google Drive)
      properties['Invoice'] = {
        files: [
          {
            name: invoiceInfo.filename,
            external: {
              url: `http://localhost:${PORT}/invoices/${invoiceInfo.filename}`
            }
          }
        ]
      };
    }

    // Add submission to Google Sheets
    let sheetResult = null;
    const invoiceUrl = invoiceInfo?.driveUrl || uploadedInvoiceInfo?.driveUrl || null;

    try {
      sheetResult = await appendToMonthlySpreadsheet(formData, invoiceUrl, screenshotUrls);
      console.log(`✅ Added to Google Sheet: ${sheetResult.brand} ${sheetResult.invoiceType} - ${sheetResult.month} ${sheetResult.year}`);
    } catch (sheetError) {
      console.error('Failed to add to Google Sheet:', sheetError.message);
      // Continue with Notion submission even if Sheet fails
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

    // Include invoice data if generated
    if (invoiceInfo) {
      responseData.invoice = {
        filename: invoiceInfo.filename,
        generated: true
      };
    }

    // Include sheet info if added successfully
    if (sheetResult) {
      responseData.sheet = {
        spreadsheetId: sheetResult.spreadsheetId,
        month: sheetResult.month,
        year: sheetResult.year
      };
    }

    res.json(responseData);

  } catch (error) {
    console.error('Error submitting to Notion:', error);
    console.error('Error details:', error.body);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to submit invoice',
    });
  }
});

// API endpoint to get brand configurations (for frontend)
app.get('/api/brands', (req, res) => {
  const brands = Object.keys(BRAND_CONFIGS).map(key => ({
    key: key,
    name: BRAND_CONFIGS[key].displayName,
    tiers: BRAND_CONFIGS[key].retainerTiers
  }));
  res.json(brands);
});

// API endpoint to get specific brand config
app.get('/api/brands/:brandKey', (req, res) => {
  const brand = getBrandConfig(req.params.brandKey);
  if (brand) {
    res.json(brand);
  } else {
    res.status(404).json({ error: 'Brand not found' });
  }
});

// Serve invoice files
app.use('/invoices', express.static(path.join(__dirname, 'invoices')));

// Serve screenshot files
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Serve the HTML form
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to access the form`);
});

// Export for Vercel deployment
module.exports = app;