# Track My Home API

Backend API voor de Flutter-app "Track My Home" die afbeeldingen verwerkt met OpenAI Vision om huishouditems te detecteren.

## 🚀 Features

- **Firebase Authentication**: Verificatie van gebruikers via Firebase ID-tokens
- **OpenAI Vision Integration**: Analyse van afbeeldingen met GPT-4o Vision
- **Collector Items Support**: Automatische herkenning en verrijking van verzamelitems (wijnen, vinyl)
  - **Wine Integration**: Vivino API integratie voor wijnbeoordelingen en details
  - **Vinyl Integration**: Discogs API integratie voor vinyl/platen informatie
- **Multi-language Support**: Ondersteuning voor meerdere talen (NL, EN, FR, DE, ES, IT, PT)
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
   - `DISCOGS_API_KEY` en `DISCOGS_API_SECRET`: Voor Discogs integratie (optioneel)
   - Vivino heeft geen officiele API key nodig

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
Verwerkt een afbeelding en detecteert alle huishouditems.

**Headers:**
```
Authorization: Bearer <Firebase_ID_Token>
Content-Type: application/json
```

**Body:**
```json
{
  "image_url": "https://firebasestorage.googleapis.com/...",
  "user_id": "firebase_user_uid",
  "language": "nl"  // OPTIONEEL - Taalcode voor output (standaard: 'en')
}
```

**Ondersteunde talen:**
- `en` - Engels (standaard)
- `nl` - Nederlands
- `fr` - Frans
- `de` - Duits
- `es` - Spaans
- `it` - Italiaans
- `pt` - Portugees

**Note:** De `name` en `description` velden worden in de opgegeven taal geretourneerd.

**Response (met language: 'nl'):**
```json
{
  "version": "1.0.4",
  "items": [
    {
      "name": "Château Margaux 2015",
      "description": "Premier Grand Cru Classé uit Bordeaux",
      "estimated_value": 450.00,
      "quantity": 1,
      "accuracy": 0.92,
      "item_type": "wine",
      "wine_details": {
        "winery": "Château Margaux",
        "vintage": 2015,
        "wine_name": "Château Margaux"
      },
      "collector_category": "wine",
      "collector_data": {
        "vivino_url": "https://www.vivino.com/wines/12345",
        "vivino_rating": 4.6,
        "vivino_reviews_count": 1523,
        "winery": "Château Margaux",
        "vintage": 2015,
        "grape_variety": "Cabernet Sauvignon blend",
        "region": "Margaux, Bordeaux, France",
        "country": "France",
        "food_pairing": ["Red meat", "Game", "Mature cheese"],
        "wine_type": "Red wine",
        "image_url": "https://...",
        "price_estimate": 450.00,
        "price_currency": "EUR"
      }
    },
    {
      "name": "Laptop",
      "description": "MacBook Pro 13-inch in goede staat",
      "estimated_value": 1200.00,
      "quantity": 1,
      "accuracy": 0.95,
      "item_type": "general",
      "collector_category": null
    }
  ],
  "token_usage": {
    "prompt_tokens": 1250,
    "completion_tokens": 180,
    "total_tokens": 1430
  },
  "processing_time": 3.7,
  "user_id": "firebase_user_uid",
  "image_deleted": true,
  "collector_stats": {
    "total_items": 2,
    "collector_items": 1,
    "wine_items": 1,
    "vinyl_items": 0,
    "general_items": 1,
    "enrichment_failures": 0
  }
}
```

**Note:** De output taal kan worden gespecificeerd via de `language` parameter. Zonder deze parameter wordt Engels gebruikt.

## 🎯 Collector Features

De API herkent automatisch verzamelbare items en verrijkt deze met gespecialiseerde informatie van externe APIs.

### Ondersteunde Collector Categorieën

#### 🍷 Wijnen (Wine)
De API integreert met Vivino om uitgebreide wijn informatie te leveren:
- **Vivino rating** en aantal reviews
- **Wijnhuis** (winery) en wijn naam
- **Vintage** jaar
- **Druivensoort** en wijn type
- **Regio** en land van herkomst
- **Food pairing** suggesties
- **Prijsschatting** van Vivino marketplace
- **Directe link** naar Vivino pagina

#### 🎵 Vinyl/Platen (Vinyl)
De API integreert met Discogs voor vinyl informatie:
- **Artist** en album titel
- **Release jaar** en label
- **Catalogus nummer**
- **Genres** en stijlen
- **Discogs rating** en community statistieken (have/want)
- **Marktprijs** informatie (min/avg)
- **Format details** (LP, 12", etc.)
- **Directe link** naar Discogs pagina

### Hoe het Werkt

1. **Automatische Detectie**: OpenAI Vision herkent of een item een wijn, vinyl of algemeen item is
2. **Detail Extractie**: Voor collector items extraheert OpenAI specifieke details (wijnhuis, vintage, artist, album, etc.)
3. **API Verrijking**: De API roept externe APIs aan (Vivino/Discogs) om aanvullende data op te halen
4. **Graceful Fallback**: Als externe API faalt, blijft het item beschikbaar met basis informatie

### Collector Item Response Structuur

Elk collector item in de response bevat:
- `item_type`: "wine", "vinyl", of "general"
- `collector_category`: "wine", "vinyl", of null
- `collector_data`: Object met verrijkte data van externe API (of null)
- `collector_warning`: Optioneel - waarschuwing als enrichment is mislukt
- `wine_details` of `vinyl_details`: Basis details geëxtraheerd door OpenAI

### Environment Configuratie voor Collector Features

```env
# Optioneel - voor Discogs integratie
DISCOGS_API_KEY=QTZqBaNFlgFGLuaYUAli
DISCOGS_API_SECRET=CDmhKLeYBmoVDnDdXqEpSmuWnkpcQHEX
```

**Discogs API Setup:**
1. Maak een Discogs account aan op https://www.discogs.com
2. Ga naar Settings > Developers: https://www.discogs.com/settings/developers
3. Klik op "Create an App" of gebruik bestaande app
4. Kopieer de **Consumer Key** naar `DISCOGS_API_KEY`
5. Kopieer de **Consumer Secret** naar `DISCOGS_API_SECRET`

**Note**: 
- Vivino integratie werkt zonder API key (gebruikt publieke endpoints)
- Discogs vereist OAuth credentials (Consumer Key/Secret) voor database toegang
- Als credentials niet zijn geconfigureerd, blijven items beschikbaar zonder enrichment

### POST /process-single
Verwerkt een afbeelding en analyseert **één specifiek item** in detail.

**Headers:**
```
Authorization: Bearer <Firebase_ID_Token>
Content-Type: application/json
```

**Body:**
```json
{
  "image_url": "https://firebasestorage.googleapis.com/...",
  "user_id": "firebase_user_uid",
  "item_name": "laptop",  // OPTIONEEL - als niet gegeven, wordt meest prominente item geanalyseerd
  "language": "nl"  // OPTIONEEL - Taalcode voor output (standaard: 'en')
}
```

**Twee modes:**

1. **Met `item_name`** - Analyseert specifiek item:
```json
{
  "image_url": "https://firebasestorage.googleapis.com/...",
  "user_id": "firebase_user_uid",
  "item_name": "laptop"
}
```

2. **Zonder `item_name`** - Analyseert meest prominente/waardevolle item:
```json
{
  "image_url": "https://firebasestorage.googleapis.com/...",
  "user_id": "firebase_user_uid"
}
```

**Response (vinyl collector item):**
```json
{
  "version": "1.0.4",
  "item": {
    "name": "Pink Floyd - Dark Side of the Moon",
    "description": "Original 1973 pressing van het iconische album",
    "estimated_value": 85.00,
    "quantity": 1,
    "accuracy": 0.89,
    "item_type": "vinyl",
    "vinyl_details": {
      "artist": "Pink Floyd",
      "album": "The Dark Side of the Moon",
      "release_year": 1973
    },
    "collector_category": "vinyl",
    "collector_data": {
      "discogs_url": "https://www.discogs.com/release/123456",
      "discogs_id": 123456,
      "artist": "Pink Floyd",
      "album": "The Dark Side of the Moon",
      "release_year": 1973,
      "label": "Harvest",
      "catalog_number": "SHVL 804",
      "genres": ["Rock", "Prog Rock"],
      "styles": ["Progressive Rock", "Psychedelic Rock"],
      "format": "Vinyl, LP, Album",
      "country": "UK",
      "discogs_rating": 4.65,
      "discogs_votes": 8234,
      "discogs_have": 45000,
      "discogs_want": 12000,
      "discogs_avg_price": 65.00,
      "discogs_currency": "EUR",
      "image_url": "https://..."
    }
  },
  "token_usage": {
    "prompt_tokens": 1180,
    "completion_tokens": 145,
    "total_tokens": 1325
  },
  "processing_time": 4.2,
  "user_id": "firebase_user_uid",
  "image_deleted": true
}
```

**Note:** 
- Alle details (conditie, merk, model, etc.) worden opgenomen in het `description` veld.
- De output taal kan worden gespecificeerd via de `language` parameter. Zonder deze parameter wordt Engels gebruikt.

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

De API gebruikt Firebase Authentication. Elke request naar `/process` of `/process-single` moet een geldige Firebase ID-token bevatten in de Authorization header.

**Flutter voorbeelden:**

### Alle items detecteren
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
    'language': 'nl', // Optioneel - voor Nederlandse output
  }),
);
```

### Specifiek item analyseren (met item naam)
```dart
final idToken = await FirebaseAuth.instance.currentUser?.getIdToken();
final response = await http.post(
  Uri.parse('https://your-api.com/process-single'),
  headers: {
    'Authorization': 'Bearer $idToken',
    'Content-Type': 'application/json',
  },
  body: jsonEncode({
    'image_url': imageUrl,
    'user_id': FirebaseAuth.instance.currentUser?.uid,
    'item_name': 'laptop', // Optioneel
    'language': 'nl', // Optioneel - voor Nederlandse output
  }),
);
```

### Meest prominente item analyseren (zonder item naam)
```dart
final idToken = await FirebaseAuth.instance.currentUser?.getIdToken();
final response = await http.post(
  Uri.parse('https://your-api.com/process-single'),
  headers: {
    'Authorization': 'Bearer $idToken',
    'Content-Type': 'application/json',
  },
  body: jsonEncode({
    'image_url': imageUrl,
    'user_id': FirebaseAuth.instance.currentUser?.uid,
    'language': 'nl', // Optioneel - voor Nederlandse output
    // Geen item_name = analyseert meest prominente item
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

## 🎨 Toekomstige Collector Categorieën

De volgende categorieën zijn gepland voor toekomstige releases:

- **📚 Boeken** - Eerste edities, zeldzame boeken, signed copies
- **🧸 Speelgoed** - Vintage speelgoed, actiefiguren, LEGO sets
- **⌚ Horloges** - Luxe horloges, vintage timepieces
- **👟 Sneakers** - Limited editions, collaborations
- **📖 Comics** - Vintage comics, graphic novels, first editions
- **🎨 Kunst** - Prints, schilderijen, limited editions

Wil je een specifieke categorie toegevoegd zien? Laat het ons weten!

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

4. **Collector enrichment failed**
   - Controleer of DISCOGS_API_KEY en DISCOGS_API_SECRET correct zijn ingesteld
   - Items blijven beschikbaar met basis informatie als enrichment faalt
   - Check de `collector_warning` veld in de response voor details

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