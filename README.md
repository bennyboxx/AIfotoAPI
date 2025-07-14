# Track My Home API

Backend API voor de Flutter-app "Track My Home" die afbeeldingen verwerkt met OpenAI Vision om huishouditems te detecteren.

## 🚀 Features

- **Firebase Authentication**: Verificatie van gebruikers via Firebase ID-tokens
- **OpenAI Vision Integration**: Analyse van afbeeldingen met GPT-4o Vision
- **Image Processing**: Download en verwerking van afbeeldingen van Firebase Storage
- **Rate Limiting**: Bescherming tegen overmatige API-aanroepen
- **Security**: Helmet.js voor beveiligingsheaders
- **Error Handling**: Uitgebreide foutafhandeling en logging

## 📋 Vereisten

- Node.js 18+ 
- Firebase project met Admin SDK
- OpenAI API key
- Firebase Storage voor afbeeldingen

## 🛠️ Installatie

1. **Clone de repository**
   ```bash
   git clone <repository-url>
   cd AIfotoAPI
   ```

2. **Installeer dependencies**
   ```bash
   npm install
   ```

3. **Configureer environment variables**
   ```bash
   cp env.example .env
   ```
   
   Vul de volgende variabelen in:
   - `OPENAI_API_KEY`: Je OpenAI API key
   - Firebase service account gegevens (zie Firebase Console)
   - Server configuratie

4. **Start de development server**
   ```bash
   npm run dev
   ```

## 🔧 Firebase Setup

1. Ga naar [Firebase Console](https://console.firebase.google.com/)
2. Maak een nieuw project of selecteer een bestaand project
3. Ga naar Project Settings > Service Accounts
4. Klik op "Generate new private key"
5. Download het JSON bestand en kopieer de waarden naar je `.env` bestand

## 📡 API Endpoints

### POST /process
Verwerkt een afbeelding en detecteert huishouditems.

**Headers:**
```
Authorization: Bearer <Firebase_ID_Token>
Content-Type: application/json
```

**Body:**
```json
{
  "image_url": "https://firebasestorage.googleapis.com/...",
  "user_id": "firebase_user_uid"
}
```

**Response:**
```json
{
  "items": [
    {
      "name": "Laptop",
      "description": "MacBook Pro 13-inch",
      "estimated_value": 1200.00,
      "quantity": 1
    },
    {
      "name": "Koffiezetapparaat",
      "description": "Philips Senseo",
      "estimated_value": 89.99,
      "quantity": 1
    }
  ],
  "processing_time": 3.7,
  "user_id": "firebase_user_uid"
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "service": "Track My Home API"
}
```

### GET /
Root endpoint met API informatie.

## 🔐 Authenticatie

De API gebruikt Firebase Authentication. Elke request naar `/process` moet een geldige Firebase ID-token bevatten in de Authorization header.

**Flutter voorbeeld:**
```dart
final idToken = await FirebaseAuth.instance.currentUser?.getIdToken();
final response = await http.post(
  Uri.parse('https://your-api.com/process'),
  headers: {
    'Authorization': 'Bearer $idToken',
    'Content-Type': 'application/json',
  },
  body: jsonEncode({
    'image_url': imageUrl,
    'user_id': FirebaseAuth.instance.currentUser?.uid,
  }),
);
```

## 🚀 Deployment

### Vercel
1. Installeer Vercel CLI: `npm i -g vercel`
2. Maak een `vercel.json` bestand:
   ```json
   {
     "version": 2,
     "builds": [
       {
         "src": "index.js",
         "use": "@vercel/node"
       }
     ],
     "routes": [
       {
         "src": "/(.*)",
         "dest": "/index.js"
       }
     ]
   }
   ```
3. Deploy: `vercel --prod`

### Firebase Cloud Functions
1. Installeer Firebase CLI: `npm i -g firebase-tools`
2. Initialiseer Firebase: `firebase init functions`
3. Kopieer de code naar de functions directory
4. Deploy: `firebase deploy --only functions`

## 📊 Rate Limiting

- **Window**: 15 minuten
- **Max requests**: 100 per IP
- Configureerbaar via environment variables

## 🛡️ Security

- **Helmet.js**: Beveiligingsheaders
- **CORS**: Cross-origin resource sharing
- **Input validation**: Validatie van alle input
- **Error handling**: Geen gevoelige informatie in errors
- **Rate limiting**: Bescherming tegen abuse

## 🔍 Troubleshooting

### Veelvoorkomende problemen:

1. **Firebase token verification failed**
   - Controleer of de service account gegevens correct zijn
   - Zorg dat de Firebase project ID klopt

2. **OpenAI API error**
   - Controleer of de API key geldig is
   - Zorg dat je voldoende credits hebt

3. **Image download failed**
   - Controleer of de Firebase Storage URL toegankelijk is
   - Zorg dat de afbeelding niet te groot is

## 📝 Logging

De API logt belangrijke events naar de console:
- Server startup
- Image processing requests
- Errors en exceptions
- Processing times

## 🤝 Contributing

1. Fork de repository
2. Maak een feature branch
3. Commit je changes
4. Push naar de branch
5. Maak een Pull Request

## 📄 License

MIT License - zie LICENSE bestand voor details. 