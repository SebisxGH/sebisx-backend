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
const supabaseUrl = process.env.SUPABASE_URL;
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
