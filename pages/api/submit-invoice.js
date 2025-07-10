<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta http-equiv="Content-Style-Type" content="text/css">
  <title></title>
  <meta name="Generator" content="Cocoa HTML Writer">
  <meta name="CocoaVersion" content="2575.4">
  <style type="text/css">
    p.p1 {margin: 0.0px 0.0px 0.0px 0.0px; font: 12.0px Helvetica}
    p.p2 {margin: 0.0px 0.0px 0.0px 0.0px; font: 12.0px Helvetica; min-height: 14.0px}
  </style>
</head>
<body>
<p class="p1">// pages/api/submit-invoice.js</p>
<p class="p1">const { Client } = require('@notionhq/client');</p>
<p class="p2"><br></p>
<p class="p1">// Initialize Notion client</p>
<p class="p1">const notion = new Client({</p>
<p class="p1"><span class="Apple-converted-space">  </span>auth: process.env.NOTION_TOKEN,</p>
<p class="p1">});</p>
<p class="p2"><br></p>
<p class="p1">const DATABASE_ID = process.env.NOTION_DATABASE_ID;</p>
<p class="p2"><br></p>
<p class="p1">export default async function handler(req, res) {</p>
<p class="p1"><span class="Apple-converted-space">  </span>if (req.method !== 'POST') {</p>
<p class="p1"><span class="Apple-converted-space">    </span>return res.status(405).json({ message: 'Method not allowed' });</p>
<p class="p1"><span class="Apple-converted-space">  </span>}</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">  </span>try {</p>
<p class="p1"><span class="Apple-converted-space">    </span>console.log('Received form submission:', req.body);</p>
<p class="p2"><span class="Apple-converted-space">    </span></p>
<p class="p1"><span class="Apple-converted-space">    </span>// Parse the form data</p>
<p class="p1"><span class="Apple-converted-space">    </span>const formData = req.body;</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>// Build properties object for Notion</p>
<p class="p1"><span class="Apple-converted-space">    </span>const properties = {</p>
<p class="p1"><span class="Apple-converted-space">      </span>'Invoice Title': {</p>
<p class="p1"><span class="Apple-converted-space">        </span>title: [</p>
<p class="p1"><span class="Apple-converted-space">          </span>{</p>
<p class="p1"><span class="Apple-converted-space">            </span>text: {</p>
<p class="p1"><span class="Apple-converted-space">              </span>content: `${formData.name || 'New'} - ${formData.invoiceType || 'Invoice'} - ${formData.period || new Date().toISOString().split('T')[0]}`,</p>
<p class="p1"><span class="Apple-converted-space">            </span>},</p>
<p class="p1"><span class="Apple-converted-space">          </span>},</p>
<p class="p1"><span class="Apple-converted-space">        </span>],</p>
<p class="p1"><span class="Apple-converted-space">      </span>},</p>
<p class="p1"><span class="Apple-converted-space">      </span>'Status': {</p>
<p class="p1"><span class="Apple-converted-space">        </span>status: {</p>
<p class="p1"><span class="Apple-converted-space">          </span>name: 'Pending',</p>
<p class="p1"><span class="Apple-converted-space">        </span>},</p>
<p class="p1"><span class="Apple-converted-space">      </span>},</p>
<p class="p1"><span class="Apple-converted-space">    </span>};</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>// Add other properties</p>
<p class="p1"><span class="Apple-converted-space">    </span>if (formData.email) {</p>
<p class="p1"><span class="Apple-converted-space">      </span>properties['Email'] = {</p>
<p class="p1"><span class="Apple-converted-space">        </span>email: formData.email,</p>
<p class="p1"><span class="Apple-converted-space">      </span>};</p>
<p class="p1"><span class="Apple-converted-space">    </span>}</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>if (formData.name) {</p>
<p class="p1"><span class="Apple-converted-space">      </span>properties['Name 1'] = {</p>
<p class="p1"><span class="Apple-converted-space">        </span>rich_text: [</p>
<p class="p1"><span class="Apple-converted-space">          </span>{</p>
<p class="p1"><span class="Apple-converted-space">            </span>text: {</p>
<p class="p1"><span class="Apple-converted-space">              </span>content: formData.name,</p>
<p class="p1"><span class="Apple-converted-space">            </span>},</p>
<p class="p1"><span class="Apple-converted-space">          </span>},</p>
<p class="p1"><span class="Apple-converted-space">        </span>],</p>
<p class="p1"><span class="Apple-converted-space">      </span>};</p>
<p class="p1"><span class="Apple-converted-space">    </span>}</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>if (formData.discord) {</p>
<p class="p1"><span class="Apple-converted-space">      </span>properties['Discord Username'] = {</p>
<p class="p1"><span class="Apple-converted-space">        </span>rich_text: [</p>
<p class="p1"><span class="Apple-converted-space">          </span>{</p>
<p class="p1"><span class="Apple-converted-space">            </span>text: {</p>
<p class="p1"><span class="Apple-converted-space">              </span>content: formData.discord,</p>
<p class="p1"><span class="Apple-converted-space">            </span>},</p>
<p class="p1"><span class="Apple-converted-space">          </span>},</p>
<p class="p1"><span class="Apple-converted-space">        </span>],</p>
<p class="p1"><span class="Apple-converted-space">      </span>};</p>
<p class="p1"><span class="Apple-converted-space">    </span>}</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>if (formData.phone) {</p>
<p class="p1"><span class="Apple-converted-space">      </span>properties['Phone'] = {</p>
<p class="p1"><span class="Apple-converted-space">        </span>phone_number: formData.phone,</p>
<p class="p1"><span class="Apple-converted-space">      </span>};</p>
<p class="p1"><span class="Apple-converted-space">    </span>}</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>if (formData.submissionType) {</p>
<p class="p1"><span class="Apple-converted-space">      </span>properties['Submission Type'] = {</p>
<p class="p1"><span class="Apple-converted-space">        </span>select: {</p>
<p class="p1"><span class="Apple-converted-space">          </span>name: formData.submissionType === 'individual' ? 'Individual' : 'Business',</p>
<p class="p1"><span class="Apple-converted-space">        </span>},</p>
<p class="p1"><span class="Apple-converted-space">      </span>};</p>
<p class="p1"><span class="Apple-converted-space">    </span>}</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>properties['Brand 1'] = {</p>
<p class="p1"><span class="Apple-converted-space">      </span>select: {</p>
<p class="p1"><span class="Apple-converted-space">        </span>name: 'Dr Dent',</p>
<p class="p1"><span class="Apple-converted-space">      </span>},</p>
<p class="p1"><span class="Apple-converted-space">    </span>};</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>if (formData.invoiceType) {</p>
<p class="p1"><span class="Apple-converted-space">      </span>properties['Invoice Type'] = {</p>
<p class="p1"><span class="Apple-converted-space">        </span>select: {</p>
<p class="p1"><span class="Apple-converted-space">          </span>name: formData.invoiceType === 'retainer' ? 'Monthly Retainer' : 'Rewards',</p>
<p class="p1"><span class="Apple-converted-space">        </span>},</p>
<p class="p1"><span class="Apple-converted-space">      </span>};</p>
<p class="p1"><span class="Apple-converted-space">    </span>}</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>if (formData.period) {</p>
<p class="p1"><span class="Apple-converted-space">      </span>properties['Period'] = {</p>
<p class="p1"><span class="Apple-converted-space">        </span>select: {</p>
<p class="p1"><span class="Apple-converted-space">          </span>name: formData.period,</p>
<p class="p1"><span class="Apple-converted-space">        </span>},</p>
<p class="p1"><span class="Apple-converted-space">      </span>};</p>
<p class="p1"><span class="Apple-converted-space">    </span>}</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>if (formData.selectedTier) {</p>
<p class="p1"><span class="Apple-converted-space">      </span>const tierMap = {</p>
<p class="p1"><span class="Apple-converted-space">        </span>'tier1': 'Tier 1',</p>
<p class="p1"><span class="Apple-converted-space">        </span>'tier2': 'Tier 2',</p>
<p class="p1"><span class="Apple-converted-space">        </span>'tier3': 'Tier 3',</p>
<p class="p1"><span class="Apple-converted-space">        </span>'tier4': 'Tier 4'</p>
<p class="p1"><span class="Apple-converted-space">      </span>};</p>
<p class="p1"><span class="Apple-converted-space">      </span>properties['Selected Tier'] = {</p>
<p class="p1"><span class="Apple-converted-space">        </span>select: {</p>
<p class="p1"><span class="Apple-converted-space">          </span>name: tierMap[formData.selectedTier],</p>
<p class="p1"><span class="Apple-converted-space">        </span>},</p>
<p class="p1"><span class="Apple-converted-space">      </span>};</p>
<p class="p1"><span class="Apple-converted-space">    </span>}</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>if (formData.accounts &amp;&amp; formData.accounts.length &gt; 0) {</p>
<p class="p1"><span class="Apple-converted-space">      </span>properties['TikTok Handle'] = {</p>
<p class="p1"><span class="Apple-converted-space">        </span>rich_text: [</p>
<p class="p1"><span class="Apple-converted-space">          </span>{</p>
<p class="p1"><span class="Apple-converted-space">            </span>text: {</p>
<p class="p1"><span class="Apple-converted-space">              </span>content: formData.accounts.map(acc =&gt; acc.handle).join(', '),</p>
<p class="p1"><span class="Apple-converted-space">            </span>},</p>
<p class="p1"><span class="Apple-converted-space">          </span>},</p>
<p class="p1"><span class="Apple-converted-space">        </span>],</p>
<p class="p1"><span class="Apple-converted-space">      </span>};</p>
<p class="p1"><span class="Apple-converted-space">    </span>}</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>if (formData.address) {</p>
<p class="p1"><span class="Apple-converted-space">      </span>properties['Address'] = {</p>
<p class="p1"><span class="Apple-converted-space">        </span>rich_text: [</p>
<p class="p1"><span class="Apple-converted-space">          </span>{</p>
<p class="p1"><span class="Apple-converted-space">            </span>text: {</p>
<p class="p1"><span class="Apple-converted-space">              </span>content: formData.address,</p>
<p class="p1"><span class="Apple-converted-space">            </span>},</p>
<p class="p1"><span class="Apple-converted-space">          </span>},</p>
<p class="p1"><span class="Apple-converted-space">        </span>],</p>
<p class="p1"><span class="Apple-converted-space">      </span>};</p>
<p class="p1"><span class="Apple-converted-space">    </span>}</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>if (formData.bankName) {</p>
<p class="p1"><span class="Apple-converted-space">      </span>properties['Bank Details'] = {</p>
<p class="p1"><span class="Apple-converted-space">        </span>rich_text: [</p>
<p class="p1"><span class="Apple-converted-space">          </span>{</p>
<p class="p1"><span class="Apple-converted-space">            </span>text: {</p>
<p class="p1"><span class="Apple-converted-space">              </span>content: `Bank: ${formData.bankName}, Account: ${formData.accountName}, Number: ${formData.accountNumber}, Sort: ${formData.sortCode}`,</p>
<p class="p1"><span class="Apple-converted-space">            </span>},</p>
<p class="p1"><span class="Apple-converted-space">          </span>},</p>
<p class="p1"><span class="Apple-converted-space">        </span>],</p>
<p class="p1"><span class="Apple-converted-space">      </span>};</p>
<p class="p1"><span class="Apple-converted-space">    </span>}</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>// Add VAT information if business submission</p>
<p class="p1"><span class="Apple-converted-space">    </span>if (formData.submissionType === 'business' &amp;&amp; formData.vatRegistered) {</p>
<p class="p1"><span class="Apple-converted-space">      </span>properties['VAT Status'] = {</p>
<p class="p1"><span class="Apple-converted-space">        </span>select: {</p>
<p class="p1"><span class="Apple-converted-space">          </span>name: formData.vatRegistered === 'yes' ? 'VAT Registered' : 'Not VAT Registered',</p>
<p class="p1"><span class="Apple-converted-space">        </span>},</p>
<p class="p1"><span class="Apple-converted-space">      </span>};</p>
<p class="p2"><span class="Apple-converted-space">      </span></p>
<p class="p1"><span class="Apple-converted-space">      </span>if (formData.vatNumber) {</p>
<p class="p1"><span class="Apple-converted-space">        </span>properties['VAT Number'] = {</p>
<p class="p1"><span class="Apple-converted-space">          </span>rich_text: [</p>
<p class="p1"><span class="Apple-converted-space">            </span>{</p>
<p class="p1"><span class="Apple-converted-space">              </span>text: {</p>
<p class="p1"><span class="Apple-converted-space">                </span>content: formData.vatNumber,</p>
<p class="p1"><span class="Apple-converted-space">              </span>},</p>
<p class="p1"><span class="Apple-converted-space">            </span>},</p>
<p class="p1"><span class="Apple-converted-space">          </span>],</p>
<p class="p1"><span class="Apple-converted-space">        </span>};</p>
<p class="p1"><span class="Apple-converted-space">      </span>}</p>
<p class="p1"><span class="Apple-converted-space">    </span>}</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>properties['Due Date'] = {</p>
<p class="p1"><span class="Apple-converted-space">      </span>date: {</p>
<p class="p1"><span class="Apple-converted-space">        </span>start: new Date().toISOString().split('T')[0],</p>
<p class="p1"><span class="Apple-converted-space">      </span>},</p>
<p class="p1"><span class="Apple-converted-space">    </span>};</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>// Create page in Notion</p>
<p class="p1"><span class="Apple-converted-space">    </span>const response = await notion.pages.create({</p>
<p class="p1"><span class="Apple-converted-space">      </span>parent: {</p>
<p class="p1"><span class="Apple-converted-space">        </span>type: "database_id",</p>
<p class="p1"><span class="Apple-converted-space">        </span>database_id: DATABASE_ID,</p>
<p class="p1"><span class="Apple-converted-space">      </span>},</p>
<p class="p1"><span class="Apple-converted-space">      </span>properties: properties,</p>
<p class="p1"><span class="Apple-converted-space">    </span>});</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>console.log('Created Notion page:', response.id);</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">    </span>res.json({</p>
<p class="p1"><span class="Apple-converted-space">      </span>success: true,</p>
<p class="p1"><span class="Apple-converted-space">      </span>message: 'Invoice submitted successfully',</p>
<p class="p1"><span class="Apple-converted-space">      </span>notionPageId: response.id,</p>
<p class="p1"><span class="Apple-converted-space">    </span>});</p>
<p class="p2"><br></p>
<p class="p1"><span class="Apple-converted-space">  </span>} catch (error) {</p>
<p class="p1"><span class="Apple-converted-space">    </span>console.error('Error submitting to Notion:', error);</p>
<p class="p1"><span class="Apple-converted-space">    </span>res.status(500).json({</p>
<p class="p1"><span class="Apple-converted-space">      </span>success: false,</p>
<p class="p1"><span class="Apple-converted-space">      </span>error: error.message || 'Failed to submit invoice',</p>
<p class="p1"><span class="Apple-converted-space">    </span>});</p>
<p class="p1"><span class="Apple-converted-space">  </span>}</p>
<p class="p1">}</p>
<p class="p2"><br></p>
<p class="p1">export const config = {</p>
<p class="p1"><span class="Apple-converted-space">  </span>api: {</p>
<p class="p1"><span class="Apple-converted-space">    </span>bodyParser: {</p>
<p class="p1"><span class="Apple-converted-space">      </span>sizeLimit: '10mb',</p>
<p class="p1"><span class="Apple-converted-space">    </span>},</p>
<p class="p1"><span class="Apple-converted-space">  </span>},</p>
<p class="p1">}</p>
</body>
</html>
