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

    console.log('🔄 veo-poll: début polling opération', operationName);

    // Poll en boucle jusqu'à done=true ou timeout 50s
    const maxPolls = 5; // 5 × 10s = 50s
    for (let i = 1; i <= maxPolls; i++) {
      if (i > 1) {
        await new Promise(r => setTimeout(r, 10000));
      }

      console.log(`🔄 veo-poll: poll ${i}/${maxPolls}...`);

      const checkUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}`;
      const checkResponse = await fetch(checkUrl, { headers: { 'x-goog-api-key': apiKey } });

      if (!checkResponse.ok) {
        const errorText = await checkResponse.text();
        console.error('❌ Erreur polling:', errorText);
        continue;
      }

      const checkText = await checkResponse.text();
      console.log('📡 Réponse polling:', checkText.substring(0, 500));

      let updatedOp: any;
      try {
        updatedOp = JSON.parse(checkText);
      } catch {
        console.error('❌ Réponse non-JSON');
        continue;
      }

      console.log('📊 done:', updatedOp.done, '| keys:', Object.keys(updatedOp));

      if (updatedOp.done) {
        const videoUri =
          updatedOp.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
          updatedOp.response?.videos?.[0]?.uri ||
          updatedOp.response?.videos?.[0]?.gcsUri;

        if (!videoUri) {
          console.error('❌ done=true mais pas d URI. Réponse complète:', JSON.stringify(updatedOp));
          return NextResponse.json({ success: false, error: 'Vidéo done mais URI absente', pending: false });
        }

        console.log('✅ Vidéo prête !', videoUri);

        // Mise à jour du Sheet si rowIndex fourni
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

        return NextResponse.json({ success: true, done: true, videoUri });
      }
    }

    // Timeout après 50s
    console.log('⏰ veo-poll timeout après 50s. Opération:', operationName);
    return NextResponse.json({ success: false, pending: true, done: false, operation: operationName });

  } catch (error: any) {
    console.error('❌ Erreur veo-poll:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
