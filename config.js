/* Impostazioni del server ponte (TURN)

   Servono per giocare anche con i dati mobili o da reti Wi-Fi diverse.
   Se restano vuote, l'app funziona lo stesso, ma solo quando i dispositivi
   riescono a collegarsi direttamente (di solito sullo stesso Wi-Fi).

   turnUser e turnPass: nome utente e password di una credenziale creata
   nella sezione "TURN Server" del pannello di Metered.

   In alternativa, al posto di quelle due, si possono usare
   meteredApp (il nome prima di ".metered.live") e meteredKey (la API key
   della credenziale).

   Usa sempre gli apostrofi dritti: 'così', non ‘così’.  */
window.PTA_CONFIG = {
  turnUser: 'bdb2c13c0ac8fc04e9def3fe',
  turnPass: 'yu+ilSnqfGG2Ie80',
  meteredApp: '',
  meteredKey: '',
};
