#!/usr/bin/env python3
"""
Script de test pour vérifier le fonctionnement du composant LastBulletinStations
"""

import requests
import json
from datetime import datetime

def test_last_bulletin_endpoint():
    """Teste l'endpoint pour récupérer le dernier bulletin"""
    # Récupérer la liste des bulletins
    try:
        response = requests.get("http://localhost:8000/api/v1/bulletins?limit=10", timeout=10)
        if response.status_code != 200:
            print(f"❌ Erreur lors de la récupération des bulletins: {response.status_code}")
            return False
            
        bulletins_data = response.json()
        bulletins = bulletins_data.get("items", []) if isinstance(bulletins_data, dict) else bulletins_data.get("bulletins", [])
        
        if not bulletins:
            print("❌ Aucun bulletin trouvé")
            return False
            
        print(f"✅ {len(bulletins)} bulletins trouvés")
        
        # Trouver la date la plus récente
        latest_date = sorted([b["date"] for b in bulletins], reverse=True)[0]
        print(f"📅 Dernier bulletin du: {latest_date}")
        
        # Tester le chargement des détails (priorité aux prévisions)
        detail_response = requests.get(f"http://localhost:8000/api/v1/bulletins/{latest_date}?type=forecast", timeout=10)
        if detail_response.status_code == 200:
            detail_data = detail_response.json()
            stations = detail_data.get("stations", [])
            print(f"✅ Détails chargés: {len(stations)} stations trouvées")
            
            # Afficher quelques informations sur les stations
            if stations:
                print("\n📋 Exemple de stations:")
                for i, station in enumerate(stations[:3]):
                    print(f"  Station {i+1}: {station.get('name', 'N/A')}")
                    print(f"    Tmin Obs: {station.get('tmin_obs', 'N/A')}°C")
                    print(f"    Tmax Obs: {station.get('tmax_obs', 'N/A')}°C")
                    print(f"    Tmin Prev: {station.get('tmin_prev', 'N/A')}°C")
                    print(f"    Tmax Prev: {station.get('tmax_prev', 'N/A')}°C")
                    print()
            
            return True
        else:
            print(f"❌ Erreur lors du chargement des détails: {detail_response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Exception lors du test: {e}")
        return False

def test_component_structure():
    """Vérifie que la structure des données est compatible avec le composant"""
    print("\n🔍 Vérification de la structure des données...")
    
    try:
        # Récupérer un bulletin de test
        response = requests.get("http://localhost:8000/api/v1/bulletins?limit=1", timeout=10)
        if response.status_code != 200:
            print("❌ Impossible de récupérer un bulletin de test")
            return False
            
        bulletins = response.json().get("items", []) or response.json().get("bulletins", [])
        if not bulletins:
            print("❌ Aucun bulletin de test disponible")
            return False
            
        latest_date = bulletins[0]["date"]
        detail_response = requests.get(f"http://localhost:8000/api/v1/bulletins/{latest_date}?type=forecast", timeout=10)
        
        if detail_response.status_code != 200:
            print("❌ Impossible de récupérer les détails du bulletin")
            return False
            
        bulletin_data = detail_response.json()
        
        # Vérifier la structure requise par le composant
        required_fields = ["date_bulletin", "type", "stations"]
        missing_fields = [field for field in required_fields if field not in bulletin_data]
        
        if missing_fields:
            print(f"❌ Champs manquants: {missing_fields}")
            return False
            
        stations = bulletin_data["stations"]
        if not stations:
            print("⚠️  Aucune station dans le bulletin")
            return True
            
        # Vérifier la structure des stations
        station_fields = ["name", "tmin_obs", "tmax_obs", "tmin_prev", "tmax_prev", "weather_obs", "weather_prev"]
        sample_station = stations[0]
        missing_station_fields = [field for field in station_fields if field not in sample_station]
        
        if missing_station_fields:
            print(f"⚠️  Champs de station manquants: {missing_station_fields}")
        else:
            print("✅ Structure des données compatible avec le composant")
            
        return True
        
    except Exception as e:
        print(f"❌ Exception lors de la vérification de structure: {e}")
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("TEST DU COMPOSANT LAST BULLETIN STATIONS")
    print("=" * 60)
    
    print(f"🕐 Heure du test: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    # Test 1: Endpoint des bulletins
    endpoint_success = test_last_bulletin_endpoint()
    
    # Test 2: Structure des données
    structure_success = test_component_structure()
    
    print("\n" + "=" * 60)
    print("RÉSUMÉ DES TESTS:")
    print(f"Endpoint bulletins: {'✅ OK' if endpoint_success else '❌ ÉCHOUÉ'}")
    print(f"Structure données: {'✅ OK' if structure_success else '❌ ÉCHOUÉ'}")
    
    if endpoint_success and structure_success:
        print("\n🎉 Tous les tests ont réussi!")
        print("Le composant LastBulletinStations devrait fonctionner correctement.")
    else:
        print("\n❌ Certains tests ont échoué.")
        print("Veuillez vérifier le backend et les données.")
    
    print("=" * 60)