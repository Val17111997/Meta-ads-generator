import { NextResponse } from 'next/server';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export async function GET() {
  try {
    // Vérifier les variables d'environnement
    if (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      return NextResponse.json({ 
        total: 0, 
        generated: 0, 
        remaining: 0,
        error: 'Configuration manquante' 
      });
    }

    const serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID!, serviceAccountAuth);
    await doc.loadInfo();
    
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    const total = rows.length;
    const generated = rows.filter(row => {
      const status = row.get('Statut') || '';
      return status.toLowerCase() === 'généré';
    }).length;
    const remaining = total - generated;
    
    console.log(`📊 Stats: ${generated}/${total} générées, ${remaining} restantes`);
    
    return NextResponse.json({ total, generated, remaining });
  } catch (error: any) {
    console.error('Erreur stats:', error.message);
    return NextResponse.json({ 
      total: 0, 
      generated: 0, 
      remaining: 0,
      error: error.message 
    });
  }
}
