import os
import time
from google import genai
from google.genai import types
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
import json

def handler(request):
    """
    Vercel Cron handler qui traite les vidéos en attente
    """
    print("🎬 Démarrage du worker vidéo...")
    
    # Configuration Google Sheets
    SHEET_ID = os.environ.get('GOOGLE_SHEET_ID')
    SERVICE_ACCOUNT_EMAIL = os.environ.get('GOOGLE_SERVICE_ACCOUNT_EMAIL')
    PRIVATE_KEY = os.environ.get('GOOGLE_PRIVATE_KEY', '').replace('\\n', '\n')
    
    # Configuration Gemini
    GEMINI_API_KEY = os.environ.get('GOOGLE_API_KEY')
    
    if not all([SHEET_ID, SERVICE_ACCOUNT_EMAIL, PRIVATE_KEY, GEMINI_API_KEY]):
        return {
            'statusCode': 500,
            'body': json.dumps({'error': 'Variables environnement manquantes'})
        }
    
    try:
        # Connexion Google Sheets
        creds = Credentials.from_service_account_info({
            'type': 'service_account',
            'client_email': SERVICE_ACCOUNT_EMAIL,
            'private_key': PRIVATE_KEY,
            'token_uri': 'https://oauth2.googleapis.com/token',
        }, scopes=['https://www.googleapis.com/auth/spreadsheets'])
        
        service = build('sheets', 'v4', credentials=creds)
        sheet = service.spreadsheets()
        
        # Lire toutes les lignes
        result = sheet.values().get(
            spreadsheetId=SHEET_ID,
            range='Sheet1!A:I'
        ).execute()
        
        rows = result.get('values', [])
        
        if len(rows) <= 1:
            print("Aucune ligne à traiter")
            return {'statusCode': 200, 'body': json.dumps({'message': 'Aucune vidéo en attente'})}
        
        headers = rows[0]
        data_rows = rows[1:]
        
        # Trouver les colonnes
        try:
            prompt_col = headers.index('Prompt')
            status_col = headers.index('Statut')
            format_col = headers.index('Format')
            type_col = headers.index('Type')
            url_col = headers.index('URL Image')
        except ValueError as e:
            print(f"❌ Colonne manquante: {e}")
            return {'statusCode': 500, 'body': json.dumps({'error': f'Colonne manquante: {e}'})}
        
        # Chercher les vidéos en cours
        videos_processed = 0
        
        for row_index, row_data in enumerate(data_rows, start=2):
            if len(row_data) <= max(prompt_col, status_col, type_col):
                continue
            
            status = row_data[status_col] if len(row_data) > status_col else ''
            video_type = row_data[type_col] if len(row_data) > type_col else ''
            
            if status.lower() == 'en cours vidéo' and video_type.lower() == 'video':
                prompt = row_data[prompt_col]
                video_format = row_data[format_col] if len(row_data) > format_col else '9:16'
                
                print(f"🎬 Génération vidéo ligne {row_index}: {prompt[:50]}...")
                
                try:
                    # Générer la vidéo avec Veo
                    video_url = generate_veo_video(GEMINI_API_KEY, prompt, video_format)
                    
                    if video_url:
                        # Mettre à jour le Sheet
                        sheet.values().update(
                            spreadsheetId=SHEET_ID,
                            range=f'Sheet1!{chr(65+status_col)}{row_index}',
                            valueInputOption='RAW',
                            body={'values': [['généré']]}
                        ).execute()
                        
                        sheet.values().update(
                            spreadsheetId=SHEET_ID,
                            range=f'Sheet1!{chr(65+url_col)}{row_index}',
                            valueInputOption='RAW',
                            body={'values': [[video_url]]}
                        ).execute()
                        
                        print(f"✅ Vidéo générée: {video_url}")
                        videos_processed += 1
                    else:
                        # Marquer comme erreur
                        sheet.values().update(
                            spreadsheetId=SHEET_ID,
                            range=f'Sheet1!{chr(65+status_col)}{row_index}',
                            valueInputOption='RAW',
                            body={'values': [['erreur génération']]}
                        ).execute()
                        
                except Exception as e:
                    print(f"❌ Erreur génération vidéo ligne {row_index}: {str(e)}")
                    sheet.values().update(
                        spreadsheetId=SHEET_ID,
                        range=f'Sheet1!{chr(65+status_col)}{row_index}',
                        valueInputOption='RAW',
                        body={'values': [[f'erreur: {str(e)[:50]}']]}
                    ).execute()
                
                # Traiter maximum 1 vidéo par cron pour éviter timeout
                if videos_processed >= 1:
                    break
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': f'{videos_processed} vidéo(s) traitée(s)',
                'videos_processed': videos_processed
            })
        }
        
    except Exception as e:
        print(f"❌ Erreur globale: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }


def generate_veo_video(api_key, prompt, video_format):
    """
    Génère une vidéo avec Veo 3.1
    """
    try:
        # Initialiser le client Gemini
        client = genai.Client(
            http_options={"api_version": "v1beta"},
            api_key=api_key,
        )
        
        # Configuration vidéo
        aspect_ratio = video_format if video_format in ['16:9', '9:16'] else '9:16'
        
        video_config = types.GenerateVideosConfig(
            aspect_ratio=aspect_ratio,
            number_of_videos=1,
            duration_seconds=8,
            person_generation="ALLOW_ADULT",
            resolution="720p",
        )
        
        print(f"📡 Lancement génération Veo (format: {aspect_ratio})...")
        
        # Lancer la génération
        operation = client.models.generate_videos(
            model="veo-3.1-generate-preview",
            prompt=prompt,
            config=video_config,
        )
        
        # Attendre que la vidéo soit générée (max 60 secondes)
        max_wait = 60
        waited = 0
        
        while not operation.done and waited < max_wait:
            print(f"⏳ Génération en cours... ({waited}s)")
            time.sleep(10)
            waited += 10
            operation = client.operations.get(operation)
        
        if not operation.done:
            print("⚠️ Timeout: vidéo pas encore prête")
            return None
        
        result = operation.result
        
        if not result or not result.generated_videos:
            print("❌ Aucune vidéo générée")
            return None
        
        generated_video = result.generated_videos[0]
        video_uri = generated_video.video.uri
        
        print(f"✅ Vidéo générée: {video_uri}")
        
        # Pour l'instant, retourner l'URI Google
        # TODO: Télécharger et uploader vers Vercel Blob
        return video_uri
        
    except Exception as e:
        print(f"❌ Erreur Veo: {str(e)}")
        return None