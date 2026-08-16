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

// 1. Ruta para buscar invocador y su partida (Existente)
app.get('/api/player/:name/:tag', async (req, res) => {
  const { name, tag } = req.params;
  try {
    const accountRes = await axios.get(
      `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
      { headers: { "X-Riot-Token": RIOT_API_KEY } }
    );
    const { puuid, gameName, tagLine } = accountRes.data;

    const summonerRes = await axios.get(
      `https://la2.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`,
      { headers: { "X-Riot-Token": RIOT_API_KEY } }
    );
    const { id: summonerId, profileIconId, summonerLevel } = summonerRes.data;

    let spectatorData = null;
    try {
      const spectatorRes = await axios.get(
        `https://la2.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${puuid}`,
        { headers: { "X-Riot-Token": RIOT_API_KEY } }
      );
      spectatorData = spectatorRes.data;
    } catch (err) {
      if (err.response && err.response.status === 404) {
        spectatorData = null; // No está en partida
      } else {
        throw err;
      }
    }

    res.json({
      gameName,
      tagLine,
      profileIconId,
      summonerLevel,
      inGame: !!spectatorData,
      gameData: spectatorData
    });

  } catch (error) {
    console.error(error.message);
    res.status(error.response ? error.response.status : 500).json({
      error: "Error al consultar la API de Riot Games"
    });
  }
});

// 2. Ruta de Registro de Usuario
app.post('/api/auth/register', async (req, res) => {
  const { email, password, username, gameName, tagLine } = req.body;

  try {
    // Registrar en Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) return res.status(400).json({ error: authError.message });

    // Guardar perfil extendido en la tabla 'profiles'
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

// 3. Ruta de Inicio de Sesión
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return res.status(400).json({ error: error.message });

    // Obtener datos del perfil guardado
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

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
// Ruta para actualizar foto de portada (banner) o avatar
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
// Obtener perfil y rangos de LoL
app.get('/api/player/:gameName/:tagLine', async (req, res) => {
  const { gameName, tagLine } = req.params;
  const RIOT_API_KEY = process.env.RIOT_API_KEY;

  if (!RIOT_API_KEY) {
    return res.status(500).json({ error: 'Falta RIOT_API_KEY en Render' });
  }

  try {
    // 1. Obtener PUUID
    const accountRes = await fetch(
      `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}?api_key=${RIOT_API_KEY}`
    );
    if (!accountRes.ok) return res.status(404).json({ error: 'Jugador no encontrado' });
    const accountData = await accountRes.json();

    // 2. Obtener Summoner ID e Icono
    const summonerRes = await fetch(
      `https://la2.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${accountData.puuid}?api_key=${RIOT_API_KEY}`
    );
    if (!summonerRes.ok) return res.status(404).json({ error: 'Invocador no encontrado en LAS' });
    const summonerData = await summonerRes.json();

    // 3. Obtener Rangos (SoloQ / Flex)
    const leagueRes = await fetch(
      `https://la2.api.riotgames.com/lol/league/v4/entries/by-summoner/${summonerData.id}?api_key=${RIOT_API_KEY}`
    );
    const leagueData = leagueRes.ok ? await leagueRes.json() : [];

    const soloQueue = leagueData.find(e => e.queueType === 'RANKED_SOLO_5x5');
    const flexQueue = leagueData.find(e => e.queueType === 'RANKED_FLEX_SR');

    res.json({
      puuid: accountData.puuid,
      profileIconId: summonerData.profileIconId,
      summonerLevel: summonerData.summonerLevel,
      solo: soloQueue ? { tier: soloQueue.tier, rank: soloQueue.rank, lp: soloQueue.leaguePoints, wins: soloQueue.wins, losses: soloQueue.losses } : null,
      flex: flexQueue ? { tier: flexQueue.tier, rank: flexQueue.rank, lp: flexQueue.leaguePoints, wins: flexQueue.wins, losses: flexQueue.losses } : null
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

    // 2. Obtener las últimas 5 partidas
    const matchesRes = await fetch(
      `https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=5&api_key=${RIOT_API_KEY}`
    );

    if (!matchesRes.ok) {
      return res.status(matchesRes.status).json({ error: 'No se encontraron partidas' });
    }

    const matchIds = await matchesRes.json();

    // 3. Traer los detalles de cada partida
    const matchDetailsPromises = matchIds.map(async (matchId) => {
      const matchRes = await fetch(
        `https://americas.api.riotgames.com/lol/match/v5/matches/${matchId}?api_key=${RIOT_API_KEY}`
      );
      const matchData = await matchRes.json();

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
    console.error('Error al obtener partidas:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
