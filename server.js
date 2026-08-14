const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5000;
const RIOT_API_KEY = 'RGAPI-ed4966a7-2de9-4463-895f-2f04c9d6b7c5';

// Servidores regionales para Spectator (Para LAS/LAN usamos la plataforma la2/la1)
// Por defecto consultamos la2 (LAS), pero luego lo haremos dinámico.
const REGION_ACCOUNT = 'americas';
const SPECTATOR_REGION = 'la2'; // la2 = LAS, la1 = LAN, na1 = NA

app.get('/api/player/:gameName/:tagLine', async (req, res) => {
    const { gameName, tagLine } = req.params;

    try {
        // 1. Obtener datos de la cuenta (PUUID)
        const accountUrl = `https://${REGION_ACCOUNT}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
        
        const accountResponse = await axios.get(accountUrl, {
            headers: { 'X-Riot-Token': RIOT_API_KEY }
        });

        const { puuid, gameName: rName, tagLine: rTag } = accountResponse.data;

        // 2. Consultar si está en partida en tiempo real (Spectator V5)
        let inGameData = null;
        let isPlaying = false;

        try {
            const spectatorUrl = `https://${SPECTATOR_REGION}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${puuid}`;
            const spectatorResponse = await axios.get(spectatorUrl, {
                headers: { 'X-Riot-Token': RIOT_API_KEY }
            });

            isPlaying = true;
            inGameData = {
                gameMode: spectatorResponse.data.gameMode, // CLASSIC (Grieta), ARAM, etc.
                gameLength: spectatorResponse.data.gameLength, // Segundos en partida
                mapId: spectatorResponse.data.mapId
            };
        } catch (spectatorError) {
            // Si da 404 significa que NO está en partida activa, es normal.
            isPlaying = false;
        }

        res.json({
            success: true,
            player: {
                puuid,
                gameName: rName,
                tagLine: rTag,
                isPlaying,
                gameInfo: inGameData
            }
        });

    } catch (error) {
        const status = error.response?.status || 500;
        const message = error.response?.data?.status?.message || error.message;

        res.status(status).json({
            success: false,
            status,
            message
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
});
