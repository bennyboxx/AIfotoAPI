# Track My Home API

Backend API voor de Flutter-app "Track My Home" die afbeeldingen verwerkt met OpenAI Vision om huishouditems te detecteren.

## 🚀 Features

- **Firebase Authentication**: Verificatie van gebruikers via Firebase ID-tokens
- **OpenAI Vision Integration**: Analyse van afbeeldingen met GPT-4o Vision
- **Collector Items Support**: Automatische herkenning en verrijking van verzamelitems
  - **Wine Integration**: Vivino search URL + GPT-4o wine details
  - **Vinyl Integration**: Discogs API + Google Vision reverse image search
  - **Book Integration**: Google Books API + Open Library (ISBN fallback)
  - **Pokémon TCG Integration**: pokemontcg.io (met TCGPlayer + CardMarket marktprijzen)
  - **Artwork Integration**: Google Vision + Metropolitan Museum + Art Institute of Chicago + Wikipedia
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
  "language": "nl",  // OPTIONEEL - Taalcode voor output (standaard: 'en')
  "tags": ["LEGO", "speelgoed", "vintage"]  // OPTIONEEL - User tags voor classificatie
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
    "book_items": 0,
    "pokemon_items": 0,
    "art_items": 0,
    "general_items": 1,
    "enrichment_failures": 0
  }
}
```

**Note:** 
- De output taal kan worden gespecificeerd via de `language` parameter. Zonder deze parameter wordt Engels gebruikt.
- De `tags` parameter is optioneel en bevat een array van user tags die de AI gebruikt voor item classificatie.

## 🏷️ Tag-Based Classification System

De API ondersteunt een flexibel tag-based systeem waarbij gebruikers custom tags kunnen meegeven voor item classificatie.

### Hoe het werkt

1. **User Tags**: De Flutter app haalt tags op uit Firestore en stuurt deze mee in de request
2. **System Tags**: De API heeft hardcoded tags voor enrichment (`wine`, `vinyl`)
3. **AI Matching**: OpenAI krijgt alle tags en matched ze semantisch met items
4. **Enrichment**: Items met `wine` of `vinyl` tags krijgen externe API data

### Voorbeeld Request met Tags

```json
POST /process
{
  "image_url": "...",
  "user_id": "abc123",
  "language": "nl",
  "tags": ["LEGO", "Star Wars", "speelgoed", "vintage"]
}
```

### Voorbeeld Response met Tags

```json
{
  "items": [
    {
      "name": "LEGO Millennium Falcon",
      "tags": ["LEGO", "Star Wars", "speelgoed"],
      "collector_category": null,
      "collector_data": null
    },
    {
      "name": "Pink Floyd - Dark Side of the Moon",
      "tags": ["vinyl", "rock", "classic"],
      "collector_category": "vinyl",
      "collector_data": { /* Discogs data */ }
    }
  ]
}
```

### Systeem Tags (met API Enrichment)

| Tag | Aliases | Enrichment API | Data |
|-----|---------|----------------|------|
| **wine** | wijn, vin, vino, wein | Vivino + GPT-4o | Rating, grape variety, region, food pairing |
| **vinyl** | plaat, LP, record, album, schijf | Discogs + Google Vision | Artist, album, year, label, genres, pricing |
| **book** | boek, livre, libro, buch, novel, roman | Google Books + Open Library | Title, authors, publisher, ISBN, cover, rating |
| **pokemon** | pokémon, pokemonkaart, pokemon card, tcg, trading card | pokemontcg.io | Card name, set, rarity, HP, TCGPlayer & CardMarket prices |
| **art** | kunst, kunstwerk, schilderij, painting, print, artwork, poster | Google Vision + Met + AIC + Wikipedia | Title, artist, date, medium, museum, description |

**Custom tags** (zoals LEGO, speelgoed, vintage) worden assigned door de AI maar hebben (nog) geen API enrichment.

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

#### 📚 Boeken (Book)
De API gebruikt Google Books (primair) + Open Library (fallback):
- **Titel** en auteur(s)
- **Uitgever** en publicatiedatum
- **Pagina-aantal** en taal
- **ISBN-10** en **ISBN-13**
- **Cover afbeelding**
- **Beschrijving** (Google Books)
- **Rating** en aantal reviews (indien beschikbaar)
- **Google Books URL** en **Open Library URL**
- **Preview link** (indien beschikbaar)
- **Fallback**: ISBN-barcode vraag als het boek niet gevonden wordt

#### 🃏 Pokémon TCG Kaarten (Pokemon)
De API integreert met pokemontcg.io voor individuele trading cards:
- **Kaartnaam** (bv. Charizard) en set (bv. Base Set)
- **Kaartnummer** (bv. 4/102) en zeldzaamheid
- **HP** en type(s) (Fire, Water, etc.)
- **Artist** en release datum
- **TCGPlayer marktprijs** (USD) — low/mid/market/high
- **CardMarket marktprijs** (EUR) — gemiddelde en trend
- **Hi-res kaart afbeelding**
- **Directe link** naar TCGPlayer en CardMarket
- **Fallback**: kaartnummer / setnaam vraag als de kaart niet herkend wordt

#### 🎨 Kunstwerken (Art)
De API gebruikt Google Vision reverse image search + meerdere gratis museum API's:
- **Primaire identificatie**: Google Vision WEB_DETECTION (zelfde aanpak als vinyl)
- **Metropolitan Museum of Art** collection API
- **Art Institute of Chicago** collection API
- **Wikipedia** REST als laatste fallback
- Data: **titel**, **kunstenaar**, **nationaliteit**, **levensjaren**, **jaar gemaakt**, **medium**, **afmetingen**, **museum**, **afbeelding**, **beschrijving**
- **Directe link** naar het museum en/of Wikipedia artikel
- **Fallback**: kunstenaar + titel vraag voor onbekende/lokale werken

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
# Vereist voor Vinyl (Discogs) integratie
DISCOGS_API_KEY=QTZqBaNFlgFGLuaYUAli
DISCOGS_API_SECRET=CDmhKLeYBmoVDnDdXqEpSmuWnkpcQHEX

# Vereist voor Vinyl + Kunstwerk identificatie (Google Vision reverse image search)
GOOGLE_CLOUD_API_KEY=your_google_cloud_api_key

# Optioneel - hogere rate limits voor Pokémon TCG
POKEMONTCG_API_KEY=your_pokemontcg_api_key
```

**Discogs API Setup:**
1. Maak een Discogs account aan op https://www.discogs.com
2. Ga naar Settings > Developers: https://www.discogs.com/settings/developers
3. Klik op "Create an App" of gebruik bestaande app
4. Kopieer de **Consumer Key** naar `DISCOGS_API_KEY`
5. Kopieer de **Consumer Secret** naar `DISCOGS_API_SECRET`

**Google Cloud Vision Setup** (voor vinyl + kunst reverse image search):
1. Ga naar [Google Cloud Console](https://console.cloud.google.com/)
2. Activeer de **Cloud Vision API** voor je project
3. Maak een API key aan en vul die in als `GOOGLE_CLOUD_API_KEY`

**Pokémon TCG Setup** (optioneel):
1. Ga naar https://dev.pokemontcg.io/
2. Registreer gratis om een API key te krijgen voor hogere rate limits
3. Vul in als `POKEMONTCG_API_KEY`

**Note**: 
- **Geen API key nodig** voor: Vivino, Google Books, Open Library, Metropolitan Museum, Art Institute of Chicago, Wikipedia en pokemontcg.io (basic)
- Vivino integratie werkt volledig zonder API key
- Discogs vereist OAuth credentials (Consumer Key/Secret)
- Google Vision is nodig voor vinyl- én kunstwerk-identificatie (reverse image search)
- Als credentials niet zijn geconfigureerd, blijven items beschikbaar zonder enrichment (met `collector_warning`)

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
  "language": "nl",  // OPTIONEEL - Taalcode voor output (standaard: 'en')
  "tags": ["electronics", "Apple", "laptop"],  // OPTIONEEL - User tags voor classificatie
  "tips": "Apple logo zichtbaar, zilveren laptop, mogelijk MacBook"  // OPTIONEEL - hints voor herkenning
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

### Alle items detecteren (met tags)
```dart
// Haal user tags op uit Firestore
final userTags = await getUserTagsFromFirestore(userId);

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
    'tags': userTags, // Optioneel - user tags voor classificatie
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
    'tips': 'Apple logo zichtbaar, zilveren laptop, mogelijk MacBook', // Optioneel - hints
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

- **🧸 Speelgoed / LEGO** - LEGO sets via Rebrickable, vintage speelgoed, actiefiguren
- **⌚ Horloges** - Luxe horloges, vintage timepieces
- **👟 Sneakers** - Limited editions, collaborations
- **📖 Comics** - Vintage comics, graphic novels, first editions
- **🎮 Videogames** - Retro games en consoles via RAWG of IGDB
- **🎲 Bordspellen** - Via BoardGameGeek API

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
   - Controleer of `DISCOGS_API_KEY` en `DISCOGS_API_SECRET` correct zijn ingesteld (vinyl)
   - Controleer of `GOOGLE_CLOUD_API_KEY` is ingesteld én de Cloud Vision API is geactiveerd (vinyl + kunst)
   - Voor **boeken**: als Google Books niks vindt, wordt Open Library geprobeerd. Fallback vraagt om ISBN.
   - Voor **Pokémon**: bij rate-limit (429) zet `POKEMONTCG_API_KEY` voor hogere limieten. Fallback vraagt om kaartnummer/setnaam.
   - Voor **kunst**: werkt alleen voor bekende werken die Google Vision herkent. Voor onbekende werken wordt de user gevraagd naar kunstenaar/titel.
   - Items blijven beschikbaar met basis informatie als enrichment faalt
   - Check het `collector_warning` veld in de response voor details

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