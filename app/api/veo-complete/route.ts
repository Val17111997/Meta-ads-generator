import { NextResponse } from 'next/server';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { operationName } = await request.json();

    if (!operationName) {
      return NextResponse.json({ success: false, error: 'operationName manquant' }, { status: 400 });
    }

    console.log('📝 veo-complete: cherche ligne avec operation:', operationName);

    const serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID!, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();

    const targetRow = rows.find(row => {
      const urlImage = (row.get('URL Image') || '').trim();
      return urlImage === operationName;
    });

    if (!targetRow) {
      console.warn('⚠️ Ligne non trouvée pour operation:', operationName);
      return NextResponse.json({ success: true, message: 'Déjà mise à jour ou introuvable' });
    }

    targetRow.set('Statut', 'généré');
    targetRow.set('URL Image', 'Téléchargée localement');
    await targetRow.save();

    console.log('✅ Sheet mis à jour: Statut → généré');
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('❌ veo-complete:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
