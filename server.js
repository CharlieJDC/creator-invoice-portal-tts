// server.js - Node.js Express Backend
const express = require('express');
const multer = require('multer');
const { Client } = require('@notionhq/client');
const cors = require('cors');
const path = require('path');
const puppeteer = require('puppeteer');
const handlebars = require('handlebars');
const fs = require('fs').promises;
require('dotenv').config();

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
      'tier1': { name: 'Tier 1', gmvRange: '<£10k', amount: 450 },
      'tier2': { name: 'Tier 2', gmvRange: '£10k - £25k', amount: 600 },
      'tier3': { name: 'Tier 3', gmvRange: '£25k - £50k', amount: 850 },
      'tier4': { name: 'Tier 4', gmvRange: '£50k+', amount: 1000 }
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

testDB();

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
    
    // Determine the tier amount based on selected tier and brand
    const tierAmount = brandConfig.retainerTiers[formData.selectedTier]?.amount || 450;
    
    // VAT calculation
    const isVatRegistered = formData.submissionType === 'business' && formData.vatRegistered === 'yes';
    const vatRate = 0.20; // 20% VAT
    const netAmount = tierAmount;
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

    // Generate invoice if method is 'generate'
    let invoiceInfo = null;
    if (formData.invoiceMethod === 'generate') {
      console.log('Generating invoice...');
      invoiceInfo = await generateInvoice(formData);
      console.log('Invoice generated:', invoiceInfo.filename);
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
        start: new Date().toISOString().split('T')[0], // Today's date
      },
    };

    // Handle screenshot files - save locally and add to Notion
    if (files.length > 0) {
      console.log(`Received ${files.length} screenshot files`);
      
      // Create screenshots directory
      await fs.mkdir(path.join(__dirname, 'screenshots'), { recursive: true });
      
      const screenshotUrls = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const filename = `screenshot-${Date.now()}-${i}-${file.originalname}`;
        const filepath = path.join(__dirname, 'screenshots', filename);
        
        // Save file
        await fs.writeFile(filepath, file.buffer);
        
        // Create URL for Notion - use hardcoded port 3001
        screenshotUrls.push({
          name: file.originalname,
          external: {
            url: `http://localhost:3001/screenshots/${filename}`
          }
        });
        
        console.log(`Saved screenshot: ${filename}`);
      }
      
      // Add screenshots to Notion properties as text links (localhost not accessible from Notion)
      if (screenshotUrls.length > 0) {
        console.log('Adding screenshots to Notion as text:', screenshotUrls);
        // Store as clickable text links since Notion can't access localhost
        properties['Screenshots'] = {
          rich_text: [
            {
              text: {
                content: screenshotUrls.map((url, index) => 
                  `Screenshot ${index + 1}: ${url.name}\nURL: ${url.external.url}`
                ).join('\n\n')
              }
            }
          ]
        };
      }
    }

    // Add invoice information if generated
    if (invoiceInfo) {
      properties['Invoice'] = {
        files: [
          {
            name: invoiceInfo.filename,
            external: {
              url: `http://localhost:3001/invoices/${invoiceInfo.filename}`
            }
          }
        ]
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

    // Include invoice data if generated
    if (invoiceInfo) {
      responseData.invoice = {
        filename: invoiceInfo.filename,
        generated: true
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