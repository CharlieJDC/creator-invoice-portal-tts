# Deployment Guide

## Environment Variables

The following environment variables need to be configured in your Netlify deployment:

### Google Drive Configuration

1. **GOOGLE_DRIVE_CREDENTIALS_JSON** (Required)
   - The entire contents of the `tmmb-477712-46b73c538755.json` file as a JSON string
   - For Netlify, copy the entire JSON object from the credentials file and paste it as a single-line string
   - Example: `{"type":"service_account","project_id":"tmmb-477712",...}`

2. **GOOGLE_DRIVE_FOLDER_ID** (Required)
   - Value: `1_CfxftnMp3JKmViyQFUO8LBpICSxW70p`
   - This is the root folder ID in the "Website" Shared Drive

3. **GOOGLE_DRIVE_IS_SHARED_DRIVE** (Required)
   - Value: `true`
   - Indicates that we're using a Google Shared Drive

### Notion Configuration

4. **NOTION_TOKEN** (Required)
   - Value: `ntn_M371992000720liJxDprI1lbthkx2TxSgtgJDy51uXkazP`
   - Integration token for Notion API access

5. **NOTION_DATABASE_ID** (Required)
   - Value: `1f50ddb9798780ce900ac5ce0bf71ac3`
   - The database ID where invoices are stored

### Cloudinary Configuration (Optional - kept as fallback)

6. **CLOUDINARY_URL** (Optional)
   - Value: `cloudinary://623774971383565:AtA1MxS-oD8LQbT_rM-_zZ2eio8@drddhxnwn`
   - Only needed if you want to use Cloudinary as a backup storage option

## File Organization Structure

Files are automatically organized in Google Drive with the following structure:

```
Website (Shared Drive)
└── Invoices
    └── [Brand Name] (e.g., "Dr Dent")
        └── [Month] (e.g., "2025-01 January")
            └── [Type] (e.g., "Retainers" or "Rewards")
                ├── invoice-files.pdf
                └── Screenshots
                    └── screenshot-files.png
```

## Netlify Setup Steps

1. Go to your Netlify site dashboard
2. Navigate to **Site settings** > **Environment variables**
3. Add each environment variable listed above
4. For `GOOGLE_DRIVE_CREDENTIALS_JSON`, copy the entire contents of `tmmb-477712-46b73c538755.json` and paste it as a single-line string
5. Deploy your site

## Security Notes

- The `.gitignore` file is configured to exclude all `.json` files except `package.json` and `package-lock.json`
- The `.env` file is excluded from version control
- Never commit sensitive credentials to the repository
- All file uploads are automatically set with public read permissions in Google Drive for Notion access

## Local Development

For local development, the system uses the `.env` file and the JSON credentials file:

```env
GOOGLE_DRIVE_CREDENTIALS_PATH=./tmmb-477712-46b73c538755.json
GOOGLE_DRIVE_FOLDER_ID=1_CfxftnMp3JKmViyQFUO8LBpICSxW70p
GOOGLE_DRIVE_IS_SHARED_DRIVE=true
NOTION_TOKEN=ntn_M371992000720liJxDprI1lbthkx2TxSgtgJDy51uXkazP
NOTION_DATABASE_ID=1f50ddb9798780ce900ac5ce0bf71ac3
PORT=3000
```

Run the local server with:
```bash
npm start
```
