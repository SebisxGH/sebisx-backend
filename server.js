const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const RIOT_API_KEY = process.env.RIOT_API_KEY;

// Inicializar Supabase
const supabaseUrl = process.env.SUPABASE_URL || 'https://hibhkohvrujbmmgrftfp.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 1. OBTENER JUGADOR, RANGOS (SOLOQ/FLEX) Y ESPECTADOR
app.get('/api/player/:gameName/:tagLine', async (req, res) => {
  const { gameName, tagLine } = req.params;

  if (!RIOT_API_KEY) {
    return res.status(500).json({ error: 'Falta RIOT_API_KEY en variables de entorno' });
  }

  try {
    // 1. Obtener Account (PUUID)
    const accountRes = await axios.get(
      `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      { headers: { "X-Riot-Token": RIOT_API_KEY } }
    );
    const { puuid, gameName: gName, tagLine: tLine } = accountRes.data;

    // 2. Obtener Summoner ID e Icono
    const summonerRes = await axios.get(
      `https://la2.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`,
      { headers: { "X-Riot-Token": RIOT_API_KEY } }
    );
    const { id: summonerId, profileIconId, summonerLevel } = summonerRes.data;

    // 3. Obtener Rangos (SoloQ y Flex) directamente por PUUID
    let leagueEntries = [];
    try {
      const leagueRes = await axios.get(
        `https://la2.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`,
        { headers: { "X-Riot-Token": RIOT_API_KEY } }
      );
      leagueEntries = leagueRes.data;
    } catch (lErr) {
      // Fallback a la llamada legacy por summonerId si falla la llamada por PUUID
      try {
        const fallbackRes = await axios.get(
          `https://la2.api.riotgames.com/lol/league/v4/entries/by-summoner/${summonerId}`,
          { headers: { "X-Riot-Token": RIOT_API_KEY } }
        );
        leagueEntries = fallbackRes.data;
      } catch (fErr) {
        console.error("No se pudieron obtener las ligas:", fErr.message);
      }
    }

    const soloQueue = leagueEntries.find(e => e.queueType === 'RANKED_SOLO_5x5');
    const flexQueue = leagueEntries.find(e => e.queueType === 'RANKED_FLEX_SR');

    // 4. Verificar si está en partida en vivo
    let spectatorData = null;
    try {
      const spectatorRes = await axios.get(
        `https://la2.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${puuid}`,
        { headers: { "X-Riot-Token": RIOT_API_KEY } }
      );
      spectatorData = spectatorRes.data;
    } catch (sErr) {
      spectatorData = null; // No está en partida
    }

    res.json({
      gameName: gName,
      tagLine: tLine,
      profileIconId,
      summonerLevel,
      inGame: !!spectatorData,
      gameData: spectatorData,
      solo: soloQueue ? { 
        tier: soloQueue.tier, 
        rank: soloQueue.rank, 
        leaguePoints: soloQueue.leaguePoints, 
        wins: soloQueue.wins, 
        losses: soloQueue.losses 
      } : null,
      flex: flexQueue ? { 
        tier: flexQueue.tier, 
        rank: flexQueue.rank, 
        leaguePoints: flexQueue.leaguePoints, 
        wins: flexQueue.wins, 
        losses: flexQueue.losses 
      } : null
    });

  } catch (error) {
    console.error("Error en /api/player:", error.response ? error.response.data : error.message);
    res.status(error.response ? error.response.status : 500).json({
      error: "Error al consultar la API de Riot Games"
    });
  }
});

// 2. OBTENER HISTORIAL DE LAS ÚLTIMAS 5 PARTIDAS
app.get('/api/matches/:gameName/:tagLine', async (req, res) => {
  const { gameName, tagLine } = req.params;

  if (!RIOT_API_KEY) {
    return res.status(500).json({ error: 'Falta RIOT_API_KEY' });
  }

  try {
    // 1. Obtener PUUID
    const accountRes = await axios.get(
      `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      { headers: { "X-Riot-Token": RIOT_API_KEY } }
    );
    const { puuid } = accountRes.data;

    // 2. Obtener IDs de las últimas 5 partidas
    const matchesRes = await axios.get(
      `https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=5`,
      { headers: { "X-Riot-Token": RIOT_API_KEY } }
    );
    const matchIds = matchesRes.data;

    // 3. Traer los detalles de cada partida en paralelo
    const matchDetailsPromises = matchIds.map(async (matchId) => {
      const matchRes = await axios.get(
        `https://americas.api.riotgames.com/lol/match/v5/matches/${matchId}`,
        { headers: { "X-Riot-Token": RIOT_API_KEY } }
      );
      const matchData = matchRes.data;
      const participant = matchData.info.participants.find(p => p.puuid === puuid);

      return {
        matchId: matchData.metadata.matchId,
        gameMode: matchData.info.gameMode,
        win: participant ? participant.win : false,
        championName: participant ? participant.championName : 'Desconocido',
        kills: participant ? participant.kills : 0,
        deaths: participant ? participant.deaths : 0,
        assists: participant ? participant.assists : 0,
        kda: participant && participant.deaths > 0 
          ? ((participant.kills + participant.assists) / participant.deaths).toFixed(2) 
          : (participant ? (participant.kills + participant.assists).toFixed(2) : '0.00')
      };
    });

    const matchesList = await Promise.all(matchDetailsPromises);
    res.json(matchesList);

  } catch (err) {
    console.error('Error al obtener partidas:', err.response ? err.response.data : err.message);
    res.status(500).json({ error: 'Error al obtener las partidas' });
  }
});

// 3. REGISTRO DE USUARIO
app.post('/api/auth/register', async (req, res) => {
  const { email, password, username, gameName, tagLine } = req.body;

  try {
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) return res.status(400).json({ error: authError.message });

    if (authData.user) {
      const { error: profileError } = await supabase
        .from('profiles')
        .insert([
          {
            id: authData.user.id,
            username: username,
            game_name: gameName,
            tag_line: tagLine
          }
        ]);

      if (profileError) return res.status(400).json({ error: profileError.message });
    }

    res.json({ message: "Usuario registrado con éxito", user: authData.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. INICIO DE SESIÓN
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return res.status(400).json({ error: error.message });

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    res.json({
      session: data.session,
      user: data.user,
      profile
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. ACTUALIZAR PORTADA (BANNER)
app.post('/api/profile/update-banner', async (req, res) => {
  const { userId, bannerUrl } = req.body;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({ banner_url: bannerUrl })
      .eq('id', userId)
      .select();

    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: "Portada actualizada con éxito", profile: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
