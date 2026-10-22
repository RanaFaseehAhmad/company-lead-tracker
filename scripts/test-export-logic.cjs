const fs = require('fs');
const { SignJWT } = require('jose');

async function testExportLogic() {
  const env = fs.readFileSync('.env.local', 'utf8');
  let secret = '';
  for (const line of env.split('\n')) {
    if (line.startsWith('JWT_SECRET=')) secret = line.slice('JWT_SECRET='.length).trim();
  }
  const secretKey = new TextEncoder().encode(secret);

  const ALPHA_COMPANY_ID = '6ace5de5a51c5c2473fbd3ce';
  const ALPHA_USER_ID = '6ace5de6a51c5c2473fbd3cf';

  const token = await new SignJWT({ userId: ALPHA_USER_ID, role: 'company_admin', companyId: ALPHA_COMPANY_ID })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(secretKey);

  // Fetch company forms
  const formsRes = await fetch('http://localhost:3000/api/forms', {
    headers: { Cookie: 'auth_token=' + token }
  });
  const formsData = await formsRes.json();
  console.log('Company forms count:', formsData.data?.length);
  for (const f of formsData.data || []) {
    console.log(`Form: "${f.title || f.name}" (ID: ${f._id}, Status: ${f.status})`);
    if (f.fields) {
      console.log('  Fields:', f.fields.map(fld => `${fld.label} (${fld.name}, ${fld.type})`).join('; '));
    }
  }

  // Fetch company leads
  const leadsRes = await fetch('http://localhost:3000/api/leads?limit=100', {
    headers: { Cookie: 'auth_token=' + token }
  });
  const leadsData = await leadsRes.json();
  console.log('\nTotal leads count:', leadsData.data?.length);
  for (const l of leadsData.data || []) {
    console.log(`Lead: ID=${l._id}, Name="${l.contactPerson}", Company="${l.companyName}", Phone="${l.phone}", Status="${l.status}"`);
    console.log('  submissionData:', JSON.stringify(l.submissionData));
  }
}

testExportLogic();
