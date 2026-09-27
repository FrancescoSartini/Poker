/* Impostazioni del server ponte (TURN)

   Servono per giocare anche con i dati mobili o da reti Wi-Fi diverse.
   Senza queste due righe l'app funziona lo stesso, ma solo quando i
   dispositivi riescono a collegarsi direttamente (di solito sullo stesso Wi-Fi).

   Come compilarle:
   1. Crea un account gratuito su metered.ca e crea un'app.
   2. meteredApp: il nome della tua app, cioè la parte prima di ".metered.live"
      (se il tuo indirizzo è pokermara.metered.live, scrivi 'pokermara').
   3. meteredKey: la API key del server TURN, che trovi nel pannello di Metered.

   Lascia le virgolette: per esempio  meteredApp: 'pokermara',  */
window.PTA_CONFIG = {
  meteredApp: '',
  meteredKey: '',
};
