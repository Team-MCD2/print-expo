# BOUTIDIDACT Print — APK Android (relais cloud)

Application **Expo / React Native** qui tourne sur un téléphone Android du magasin : elle récupère les tickets sur le cloud et les imprime sur l’**imprimante thermique du même réseau WiFi** (TCP port 9100).

**Aucun PC requis** — c’est le mode relais recommandé en production.

**Version actuelle** : 1.0.10 (voir `app.json`)

## Prérequis utilisateur

- Android 8+  
- Téléphone sur le **même WiFi** que l’imprimante  
- Notifications autorisées + batterie sans restriction (pour l’arrière-plan)  
- Compte boutique actif sur BOUTIDIDACT  

## Configuration (3 champs)

| Champ | Exemple | Obligatoire |
|-------|---------|-------------|
| Nom de la boutique | `MaBoutique` | Oui — identique à la connexion borne |
| IP imprimante | `192.168.1.26` | Oui |
| Clé relais | (depuis Admin borne → Relais) | Recommandée |

Puis **Démarrer le relais** → notification persistante « Boutididact Relay ».

**Tester l’imprimante** (bouton local) : test TCP direct, sans passer par le cloud.

## Fonctionnement technique

```
Cloud (poll /api/saas/poll-ticket toutes les 5 s)
        ↓
Service Android natif (RelayForegroundService)
        ↓
TCP 9100 → imprimante ESC/POS
```

- Service **foreground** + **WakeLock** : impression en veille  
- **BootReceiver** : relais restauré après redémarrage du téléphone (si actif avant)  
- Tickets avec **articles + total** en JSON ; ESC/POS régénéré ou `escposB64` du serveur  

## Développement

```powershell
cd boutididact-print-expo
npm install
npx expo start
```

**APK production** (module natif Java obligatoire — pas Expo Go seul) :

```powershell
npx eas-cli build --platform android --profile production
```

Télécharger l’artifact `.apk` depuis le dashboard Expo.

Copier vers le frontend :

```text
frontend/public/downloads/Boutididact-Print-Server.apk
```

## Fichiers importants

| Fichier | Rôle |
|---------|------|
| `App.js` | UI configuration + démarrage relais |
| `relayCore.js` | Poll cloud, ESC/POS, test TCP |
| `relayService.js` | Pont vers service natif Android |
| `plugins/native-relay/android/RelayForegroundService.java` | Poll + print arrière-plan |
| `index.js` | Fallback foreground JS si pas de module natif |

**URL cloud** : `https://boutididact-backendd.vercel.app` (constante dans `relayCore.js` et service Java).

## Dépannage

| Symptôme | Action |
|----------|--------|
| Pas d’impression | Vérifier WiFi, IP imprimante, relais démarré, backend déployé |
| Ticket vide / 0 € | Redéployer backend récent ; nouvelle commande test |
| Ticket TEST après commande | Mettre à jour APK ≥ 1.0.9 |
| Relais s’arrête | Batterie « non restreinte », laisser la notification active |

## Build local Android (dev)

```powershell
npx expo prebuild --platform android
npx expo run:android
```

Plugins : `withNativeRelay.js`, `withForegroundService.js`.
