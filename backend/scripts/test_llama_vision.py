#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de test pour Llama 3.2 Vision via Hugging Face Inference Client
Ce script analyse des images de cartes meteorologiques pour detecter les icones meteo.

Usage:
    python backend/scripts/test_llama_vision.py --image path/to/image.jpg
    python backend/scripts/test_llama_vision.py --image path/to/image.jpg --prompt "Decris les conditions meteorologiques"
"""

import argparse
import base64
import json
import logging
import os
from pathlib import Path
from typing import Optional, Dict, Any

from huggingface_hub import InferenceClient
from PIL import Image
import io

# Configuration du logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class LlamaVisionTester:
    """Testeur pour Llama 3.2 Vision via Hugging Face Inference Client"""

    def __init__(self, api_token: Optional[str] = None):
        """
        Initialise le testeur Llama Vision

        Args:
            api_token: Token d'authentification Hugging Face (optionnel)
        """
        self.api_token = api_token or os.getenv("HF_TOKEN")
        if not self.api_token:
            logger.warning("Aucun token HF_API_TOKEN trouve. Certaines fonctionnalites peuvent etre limitees.")

        # Modele Llama 3.2 Vision recommande
        self.model_id = "meta-llama/Llama-3.2-11B-Vision-Instruct"

        # Client officiel Hugging Face
        self.client = InferenceClient(token=self.api_token)

    def encode_image(self, image_path: str) -> str:
        """
        Encode une image en base64

        Args:
            image_path: Chemin vers l'image

        Returns:
            Chaine base64 de l'image
        """
        try:
            with Image.open(image_path) as img:
                # Convertir en RGB si necessaire
                if img.mode != 'RGB':
                    img = img.convert('RGB')

                # Redimensionner si l'image est trop grande (optionnel)
                max_size = (1024, 1024)
                if img.width > max_size[0] or img.height > max_size[1]:
                    img.thumbnail(max_size, Image.Resampling.LANCZOS)

                # Encoder en base64
                buffered = io.BytesIO()
                img.save(buffered, format="JPEG", quality=85)
                img_str = base64.b64encode(buffered.getvalue()).decode()

                return img_str
        except Exception as e:
            logger.error(f"Erreur lors de l'encodage de l'image: {e}")
            raise

    def analyze_weather_icons(self, image_path: str, custom_prompt: Optional[str] = None) -> Dict[str, Any]:
        """
        Analyse une image pour detecter les icones meteorologiques

        Args:
            image_path: Chemin vers l'image a analyser
            custom_prompt: Prompt personnalise (optionnel)

        Returns:
            Dictionnaire contenant les resultats de l'analyse
        """
        if not Path(image_path).exists():
            raise FileNotFoundError(f"Image non trouvee: {image_path}")

        # Prompt par defaut pour la detection d'icones meteo
        default_prompt = """Analyse cette carte meteorologique et identifie les icones meteorologiques presentes.
Reponds en francais avec les informations suivantes:
1. Quels types d'icones meteorologiques vois-tu ? (soleil, nuages, pluie, orages, etc.)
2. Ou sont situees ces icones sur la carte ?
3. Quelles conditions meteorologiques representent-elles ?
4. Y a-t-il des motifs ou des regularites dans leur disposition ?

Sois precis et decris chaque icone individuellement."""

        prompt = custom_prompt or default_prompt

        try:
            # Encoder l'image
            logger.info("Encodage de l'image...")
            image_base64 = self.encode_image(image_path)

            image_url = f"data:image/jpeg;base64,{image_base64}"

            logger.info(f"Envoi de la requete a {self.model_id} via InferenceClient...")

            result = self.client.chat.completions.create(
                model=self.model_id,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": image_url}},
                        ],
                    }
                ],
                max_tokens=500,
                temperature=0.7,
                top_p=0.9,
            )

            logger.info("Analyse reussie!")

            return {
                "success": True,
                "image_path": image_path,
                "model_used": self.model_id,
                "prompt_used": prompt,
                "response": result,
                "raw_response": str(result),
            }

        except Exception as e:
            logger.error(f"Erreur lors de l'analyse: {e}")
            return {
                "success": False,
                "error": str(e),
                "image_path": image_path
            }

    def batch_analyze(self, image_paths: list, custom_prompt: Optional[str] = None) -> list:
        """
        Analyse plusieurs images en batch

        Args:
            image_paths: Liste des chemins d'images
            custom_prompt: Prompt personnalise (optionnel)

        Returns:
            Liste des resultats d'analyse
        """
        results = []

        for i, image_path in enumerate(image_paths, 1):
            logger.info(f"Analyse de l'image {i}/{len(image_paths)}: {image_path}")
            result = self.analyze_weather_icons(image_path, custom_prompt)
            results.append(result)

            # Pause entre les requetes pour eviter les rate limits
            if i < len(image_paths):
                import time
                time.sleep(1)

        return results

def main():
    """Fonction principale du script"""
    parser = argparse.ArgumentParser(
        description="Test Llama 3.2 Vision pour la detection d'icones meteorologiques",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples d'utilisation:
  python test_llama_vision.py --image carte_meteo.jpg
  python test_llama_vision.py --image carte_meteo.jpg --prompt "Quel temps fait-il a Ouagadougou ?"
  python test_llama_vision.py --batch dossier_images/
        """
    )

    parser.add_argument(
        "--image",
        type=str,
        help="Chemin vers une image a analyser"
    )

    parser.add_argument(
        "--batch",
        type=str,
        help="Dossier contenant plusieurs images a analyser"
    )

    parser.add_argument(
        "--prompt",
        type=str,
        help="Prompt personnalise pour l'analyse"
    )

    parser.add_argument(
        "--output",
        type=str,
        default="llama_vision_results.json",
        help="Fichier de sortie pour les resultats (defaut: llama_vision_results.json)"
    )

    parser.add_argument(
        "--token",
        type=str,
        help="Token d'authentification Hugging Face (optionnel)"
    )

    args = parser.parse_args()

    # Validation des arguments
    if not args.image and not args.batch:
        parser.error("Vous devez specifier --image ou --batch")

    if args.image and args.batch:
        parser.error("Vous ne pouvez pas specifier --image et --batch simultanement")

    # Initialiser le testeur
    tester = LlamaVisionTester(api_token=args.token)

    print("=" * 60)
    print("TEST LLAMA 3.2 VISION - DETECTION D'ICONES METEO")
    print("=" * 60)
    print(f"Modele utilise: {tester.model_id}")
    print(f"Token API: {'OK' if tester.api_token else 'NON'}")
    print()

    results = []

    try:
        if args.image:
            # Analyse d'une seule image
            print(f"Analyse de: {args.image}")
            result = tester.analyze_weather_icons(args.image, args.prompt)
            results.append(result)

        elif args.batch:
            # Analyse batch
            batch_path = Path(args.batch)
            if not batch_path.exists():
                raise FileNotFoundError(f"Dossier non trouve: {args.batch}")

            # Trouver les images
            image_extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp'}
            image_files = [
                f for f in batch_path.iterdir()
                if f.is_file() and f.suffix.lower() in image_extensions
            ]

            if not image_files:
                raise ValueError(f"Aucune image trouvee dans {args.batch}")

            print(f"Analyse batch de {len(image_files)} images...")
            results = tester.batch_analyze([str(f) for f in image_files], args.prompt)

        # Afficher les resultats
        print("\n" + "=" * 60)
        print("RESULTATS DE L'ANALYSE")
        print("=" * 60)

        successful = 0
        failed = 0

        for i, result in enumerate(results, 1):
            print(f"\n--- Resultat {i} ---")
            if result.get("success"):
                successful += 1
                print(f"OK Image: {result['image_path']}")
                print("Reponse du modele:")
                print("-" * 40)

                # Extraire et afficher la reponse
                response_text = ""
                response = result.get("response")
                if hasattr(response, "choices") and response.choices:
                    response_text = response.choices[0].message.content or ""
                else:
                    response_text = str(response)

                print(response_text)
                print("-" * 40)
            else:
                failed += 1
                print(f"ECHEC Image: {result.get('image_path')}")
                print(f"Erreur: {result.get('error')}")

        # Sauvegarder les resultats
        output_file = Path(args.output)
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2, ensure_ascii=False)

        print(f"\nResultats sauvegardes dans: {output_file}")
        print(f"Statistiques: {successful} reussi(s), {failed} echec(s)")

    except KeyboardInterrupt:
        print("\n\nAnalyse interrompue par l'utilisateur")
    except Exception as e:
        logger.error(f"Erreur critique: {e}")
        print(f"\nErreur: {e}")

if __name__ == "__main__":
    main()
