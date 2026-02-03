import { NextResponse } from 'next/server';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export const maxDuration = 55;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const operationName = url.searchParams.get('operation');

    if (!operationName) {
      return NextResponse.json({ success: false, error: 'Paramètre operation manquant' }, { status: 400 });
    }

    const apiKeys = process.env.GOOGLE_API_KEY!.split(',');
    const apiKey = apiKeys[0];

    console.log('🔄 veo-poll: polling opération', operationName);

    // Poll une seule fois par appel — le frontend re-appelle en boucle
    const checkUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`;
    const checkResponse = await fetch(checkUrl);

    if (!checkResponse.ok) {
      const errorText = await checkResponse.text();
      console.error('❌ Erreur polling:', errorText);
      return NextResponse.json({ success: false, error: `Polling HTTP ${checkResponse.status}`, pending: true });
    }

    const checkText = await checkResponse.text();
    console.log('📡 Réponse polling:', checkText.substring(0, 500));

    let updatedOp: any;
    try {
      updatedOp = JSON.parse(checkText);
    } catch {
      return NextResponse.json({ success: false, error: 'Réponse non-JSON', pending: true });
    }

    console.log('📊 done:', updatedOp.done);

    if (!updatedOp.done) {
      // Pas encore prêt — retourner pending
      return NextResponse.json({ success: false, pending: true, done: false });
    }

    // done=true — extraire l'URI avec les deux chemins possibles
    const videoUri =
      updatedOp.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
      updatedOp.response?.videos?.[0]?.uri ||
      updatedOp.response?.videos?.[0]?.gcsUri;

    if (!videoUri) {
      console.error('❌ done=true mais pas d\'URI. Réponse:', JSON.stringify(updatedOp));
      return NextResponse.json({ success: false, error: 'Vidéo done mais URI absente', pending: false });
    }

    console.log('✅ Vidéo prête !', videoUri);

    // Mise à jour du Sheet
    try {
      const rowIndex = url.searchParams.get('rowIndex');
      if (rowIndex) {
        const serviceAccountAuth = new JWT({
          email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID!, serviceAccountAuth);
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();
        const row = rows[parseInt(rowIndex)];
        if (row) {
          row.set('Statut', 'généré');
          row.set('URL Image', videoUri);
          row.set('Date génération', new Date().toLocaleString('fr-FR'));
          await row.save();
          console.log('✅ Sheet mis à jour');
        }
      }
    } catch (sheetErr) {
      console.error('⚠️ Erreur mise à jour Sheet (non-bloquant):', sheetErr);
    }

    return NextResponse.json({
      success: true,
      done: true,
      videoUri,
    });

  } catch (error: any) {
    console.error('❌ Erreur veo-poll:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
