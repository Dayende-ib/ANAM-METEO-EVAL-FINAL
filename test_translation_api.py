#!/usr/bin/env python3
"""
Script de test pour la nouvelle API de traduction en mooré
"""

import requests
import json

def test_external_translation_api():
    """Teste l'API externe de traduction en mooré"""
    url = "https://fr-mos-translator-314397473739.europe-west1.run.app/api/translate"
    payload = {
        "text": "Bonjour, comment allez-vous aujourd'hui ?",
        "source_lang": "french",
        "target_lang": "moore"
    }
    
    print("🔍 Test de l'API externe de traduction...")
    print(f"URL: {url}")
    print(f"Payload: {json.dumps(payload, indent=2)}")
    
    try:
        response = requests.post(url, json=payload, timeout=30)
        print(f"Statut: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print("✅ Succès!")
            print(f"Réponse: {json.dumps(result, indent=2, ensure_ascii=False)}")
            return True
        else:
            print(f"❌ Erreur: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Exception: {e}")
        return False

def test_backend_integration():
    """Teste l'intégration avec le backend"""
    backend_url = "http://localhost:8000/api/v1/bulletins/regenerate-translation-async"
    payload = {
        "date": "2024-07-01",
        "station_name": "Bulletin National",
        "language": "moore"
    }
    
    print("\n🔍 Test de l'intégration backend...")
    print(f"URL: {backend_url}")
    print(f"Payload: {json.dumps(payload, indent=2)}")
    
    try:
        response = requests.post(backend_url, json=payload, timeout=30)
        print(f"Statut: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print("✅ Succès!")
            print(f"Réponse: {json.dumps(result, indent=2, ensure_ascii=False)}")
            return True
        else:
            print(f"❌ Erreur: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Exception: {e}")
        return False

if __name__ == "__main__":
    print("=" * 50)
    print("TEST DE LA NOUVELLE API DE TRADUCTION EN MOORÉ")
    print("=" * 50)
    
    # Test de l'API externe
    external_success = test_external_translation_api()
    
    # Test de l'intégration backend
    backend_success = test_backend_integration()
    
    print("\n" + "=" * 50)
    print("RÉSUMÉ DES TESTS:")
    print(f"API externe: {'✅ OK' if external_success else '❌ ÉCHOUÉ'}")
    print(f"Intégration backend: {'✅ OK' if backend_success else '❌ ÉCHOUÉ'}")
    print("=" * 50)