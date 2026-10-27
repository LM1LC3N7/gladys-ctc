// -----------------------------------------------------------------------------
// Runtime texts (English and French): feature, option and state names, the
// status of the integration, the answers of the buttons and the command
// errors. The state names translate the codes of CTC's BMS manual.
// -----------------------------------------------------------------------------

import { FEATURES as F } from './constants.js';

const both = (en, fr) => ({ en, fr });

/** One language of a `{ en, fr }` text. */
export const word = (value, language) => (language === 'en' ? value.en : value.fr);

/** Several texts in one, each language apart. */
export const join = (parts) =>
  both(parts.map((p) => p.en).join(' '), parts.map((p) => p.fr).join(' '));

/** "45 s", "5 min", "2 h", in both languages. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

export const DEVICE_NAME = both('CTC heat pump', 'Pompe à chaleur CTC');

export const FEATURE_NAMES = {
  [F.HEATING_MODE]: both('Heating circuit 1 mode (control)', 'Mode du circuit 1 (pilotage)'),
  [F.DHW_MODE]: both('Hot water mode (control)', "Mode de l'eau chaude (pilotage)"),
  [F.ROOM_SETPOINT]: both('Room setpoint, circuit 1', 'Consigne de la pièce, circuit 1'),
  [F.OVERRIDES]: both('Control held by Gladys', 'Pilotage tenu par Gladys'),
  [F.SYSTEM_STATUS]: both('System status', 'État du système'),
  [F.HEATPUMP_STATUS]: both('Heat pump status', 'État de la pompe à chaleur'),
  [F.HEATING_STATUS]: both('Heating circuit 1 status', 'État du circuit de chauffage 1'),
  [F.SMARTGRID]: both('SmartGrid mode', 'Mode SmartGrid'),
  [F.DHW_MODE_SETTING]: both('Hot water mode (setting)', "Mode de l'eau chaude (réglage)"),
  [F.HEATING_MODE_SETTING]: both(
    'Heating circuit 1 mode (setting)',
    'Mode de chauffage du circuit 1 (réglage)',
  ),
  [F.COMPRESSOR]: both('Compressor running', 'Compresseur en marche'),
  [F.DEFROST]: both('Defrosting', 'Dégivrage en cours'),
  [F.ALARM]: both('Heat pump stopped by an alarm', 'Pompe à chaleur arrêtée par une alarme'),
  [F.TEMP_OUTDOOR]: both('Outdoor temperature', 'Température extérieure'),
  [F.TEMP_RADIATOR]: both('Radiator water', 'Eau des radiateurs'),
  [F.FLOW_SETPOINT]: both('Flow setpoint, circuit 1', 'Consigne de départ, circuit 1'),
  [F.TEMP_FLOW]: both('Flow temperature, circuit 1', 'Température de départ, circuit 1'),
  [F.TEMP_RETURN]: both('Return temperature', 'Température de retour'),
  [F.TEMP_HP_IN]: both('Heat pump in', 'Entrée pompe à chaleur'),
  [F.TEMP_HP_OUT]: both('Heat pump out', 'Sortie pompe à chaleur'),
  [F.TEMP_DISCHARGE]: both('Discharge gas', 'Gaz de refoulement'),
  [F.TEMP_SUCTION]: both('Suction gas', "Gaz d'aspiration"),
  [F.TEMP_BRINE_IN]: both('Brine in', 'Eau glycolée entrée'),
  [F.TEMP_BRINE_OUT]: both('Brine out', 'Eau glycolée sortie'),
  [F.TEMP_HP_OUTDOOR]: both(
    'Outdoor temperature at the heat pump',
    'Température extérieure à la PAC',
  ),
  [F.TEMP_ROOM]: both('Room temperature 1', 'Température de la pièce 1'),
  [F.TEMP_ROOM_2]: both('Room temperature 2', 'Température de la pièce 2'),
  [F.TANK_LOWER_SETPOINT]: both('Lower tank setpoint', 'Consigne du ballon bas'),
  [F.TEMP_DHW_LOWER]: both('Hot water, lower', 'Eau chaude, bas'),
  [F.TEMP_DHW]: both('Hot water', 'Eau chaude'),
  [F.ROOM_SETTING]: both('Room setting, circuit 1', 'Réglage de la pièce, circuit 1'),
  [F.PRESSURE_HIGH]: both('High pressure', 'Haute pression'),
  [F.PRESSURE_LOW]: both('Low pressure', 'Basse pression'),
  [F.CHARGE_PUMP]: both('Charge pump (%)', 'Pompe de charge (%)'),
  [F.BRINE_PUMP]: both('Brine pump (%)', "Pompe d'eau glycolée (%)"),
  [F.FAN]: both('Fan (%)', 'Ventilateur (%)'),
  [F.DEGREE_MINUTES]: both('Degree minutes', 'Degrés-minutes'),
  [F.IMMERSION_POWER]: both('Immersion heater power', 'Puissance de la résistance'),
  [F.IMMERSION_POWER_LOWER]: both(
    'Lower immersion heater power',
    'Puissance de la résistance basse',
  ),
  [F.CURRENT_L1]: both('Current L1', 'Courant L1'),
  [F.CURRENT_L2]: both('Current L2', 'Courant L2'),
  [F.CURRENT_L3]: both('Current L3', 'Courant L3'),
  [F.IMMERSION_ENERGY]: both(
    'Immersion heater energy (kWh, counter)',
    'Énergie de la résistance (kWh, compteur)',
  ),
  [F.COMPRESSOR_SPEED]: both('Compressor speed (rps)', 'Vitesse du compresseur (tr/s)'),
  [F.COMPRESSOR_HOURS]: both('Compressor operating time (h)', 'Fonctionnement du compresseur (h)'),
  [F.COMPRESSOR_MINUTES_24H]: both(
    'Compressor, last 24 h (min)',
    'Compresseur, dernières 24 h (min)',
  ),
  [F.DHW_CAPACITY]: both('Hot water capacity', "Capacité d'eau chaude"),
  [F.COMPRESSOR_ENERGY]: both(
    'Compressor energy (kWh, counter)',
    'Énergie du compresseur (kWh, compteur)',
  ),
};

/** The options of the two selects. `program`: control given back to the controller. */
export const OPTION_NAMES = {
  program: both("Controller's own program", 'Programme du régulateur'),
  off: both('Heating off', 'Chauffage arrêté'),
  heat: both('Heating', 'Chauffage'),
  auto: both('Auto', 'Auto'),
  economy: both('Economy', 'Économie'),
  normal: both('Normal', 'Normal'),
  comfort: both('Comfort', 'Confort'),
};

/** The state texts, by enum (src/ctc.js ENUMS) and key. */
export const ENUM_NAMES = {
  system: {
    hpUpper: both('Heat pump, upper tank', 'Pompe à chaleur, ballon haut'),
    hpLower: both('Heat pump, lower tank', 'Pompe à chaleur, ballon bas'),
    additional: both('Additional heat', "Chauffage d'appoint"),
    hpAndAdditional: both('Heat pump and additional heat', 'Pompe à chaleur et appoint'),
    heating: both('Heating', 'Chauffage'),
    hotWater: both('Hot water', 'Eau chaude'),
    pool: both('Pool', 'Piscine'),
    off: both('Off', 'Arrêt'),
    heatingMix: both('Heating mix', 'Chauffage mixte'),
    wood: both('Wood', 'Bois'),
    hotWaterHeating: both('Hot water and heating', 'Eau chaude et chauffage'),
    cooling: both('Cooling', 'Rafraîchissement'),
    swap: both('Swap', 'Bascule'),
  },
  heatpump: {
    startDelay: both('Compressor off, start delay', 'Compresseur arrêté, délai de démarrage'),
    readyToStart: both('Compressor off, ready to start', 'Compresseur arrêté, prêt'),
    waitingForFlow: both('Waiting for flow', 'Attente du débit'),
    heating: both('Compressor on, heating', 'Compresseur en marche, chauffage'),
    defrost: both('Defrosting', 'Dégivrage'),
    cooling: both('Compressor on, cooling', 'Compresseur en marche, rafraîchissement'),
    blocked: both('Compressor off, blocked', 'Compresseur arrêté, bloqué'),
    alarm: both('Compressor off, alarm', 'Compresseur arrêté, alarme'),
  },
  heating: {
    heatingOff: both('Heating off', 'Chauffage arrêté'),
    vacation: both('Vacation', 'Vacances'),
    nightReduction: both('Night reduction', 'Réduit de nuit'),
    on: both('On', 'Marche'),
  },
  smartgrid: {
    normal: both('Normal', 'Normal'),
    block: both('Blocked', 'Blocage'),
    lowPrice: both('Low price', 'Prix bas'),
    highCapacity: both('Overcapacity', 'Surcapacité'),
  },
  dhwMode: {
    economy: both('Economy', 'Économie'),
    normal: both('Normal', 'Normal'),
    comfort: both('Comfort', 'Confort'),
  },
  heatingModeSetting: {
    auto: both('Auto', 'Auto'),
    on: both('On', 'Marche'),
    off: both('Off', 'Arrêt'),
  },
};

export const unknownCode = (code) => both(`Unknown code ${code}`, `Code inconnu ${code}`);

/** The "Control held by Gladys" text. */
export const HOLD_TEXTS = {
  none: both(
    'None: the controller follows its own settings.',
    'Aucun : le régulateur suit ses propres réglages.',
  ),
  inForce: (name, ago) =>
    both(`${name.en} (written ${ago.en} ago)`, `${name.fr} (écrit il y a ${ago.fr})`),
  stopPending: both(
    'Heating off asked, not yet acknowledged by the controller: written again until it is.',
    "Arrêt du chauffage demandé, pas encore acquitté par le régulateur : réécrit jusqu'à ce qu'il le soit.",
  ),
  stopLapsed: (ago) =>
    both(
      `Heating off asked, not in force (no write acknowledged for ${ago.en}): written again until it is.`,
      `Arrêt du chauffage demandé, pas en vigueur (aucune écriture acquittée depuis ${ago.fr}) : réécrit jusqu'à ce qu'il le soit.`,
    ),
  roomSetpoint: (value) =>
    both(`Room setpoint ${value} °C`, `Consigne de la pièce ${String(value).replace('.', ',')} °C`),
};

/** The status of the configuration screen. */
export const T = {
  noAddress: both(
    'Enter the IP address of the CTC display (Modbus TCP).',
    "Saisissez l'adresse IP de l'écran CTC (Modbus TCP).",
  ),
  invalid: (typed) =>
    both(`"${typed}" is not a valid address.`, `« ${typed} » n'est pas une adresse valide.`),
  connecting: both('Connecting to the CTC controller...', 'Connexion au régulateur CTC...'),
  unreachable: (address, reason, wait) =>
    both(
      `The CTC controller at ${address} does not answer (${reason}); next try in ${wait.en}.`,
      `Le régulateur CTC à ${address} ne répond pas (${reason}) ; nouvel essai dans ${wait.fr}.`,
    ),
  connected: (identity, notes) =>
    join([
      both(
        `Connected to the CTC controller (display software ${identity}).`,
        `Connecté au régulateur CTC (logiciel de l'écran ${identity}).`,
      ),
      ...notes,
    ]),
  notes: {
    missing: (blocks) =>
      both(
        `Registers this model does not answer, left out: ${blocks}.`,
        `Registres auxquels ce modèle ne répond pas, ignorés : ${blocks}.`,
      ),
    stop: both('Heating off held by Gladys.', 'Arrêt du chauffage tenu par Gladys.'),
    stopPending: both(
      'Heating off asked, not yet acknowledged: written again until it is.',
      "Arrêt du chauffage demandé, pas encore acquitté : réécrit jusqu'à ce qu'il le soit.",
    ),
    store: both(
      'The state file in /data cannot be read or written: a heating off would not be written again after a restart.',
      "Le fichier d'état dans /data ne peut être lu ou écrit : un arrêt du chauffage ne serait pas réécrit après un redémarrage.",
    ),
    identity: both(
      'The display software version changed: what Gladys held was given back.',
      "La version du logiciel de l'écran a changé : ce que Gladys tenait a été rendu.",
    ),
  },
  test: {
    cooldown: both('Tested less than 10 s ago.', 'Testé il y a moins de 10 s.'),
  },
  release: {
    done: (names) =>
      both(
        `Given back to the controller: ${names.en}. It follows its own settings again within 5 minutes.`,
        `Rendu au régulateur : ${names.fr}. Il reprend ses propres réglages sous 5 minutes.`,
      ),
    nothing: both('Gladys holds nothing.', 'Gladys ne tient rien.'),
    stopKept: both(
      'The heating off is kept: giving it back restarts the heating, which needs "Allow the commands".',
      "L'arrêt du chauffage est gardé : le rendre relance le chauffage, ce qui demande « Autoriser les commandes ».",
    ),
  },
};

/** The errors a command answers to Gladys. */
export const ERRORS = {
  readOnly: both('This feature is read only.', 'Cette fonctionnalité est en lecture seule.'),
  noAddress: both(
    'No controller address in the configuration: nothing sent.',
    'Aucune adresse de régulateur dans la configuration : rien envoyé.',
  ),
  disabled: both(
    'Commands are disabled: turn on "Allow the commands" in the configuration of the integration. Only "Heating off" works without it.',
    "Les commandes sont désactivées : activez « Autoriser les commandes » dans la configuration de l'intégration. Seul « Chauffage arrêté » fonctionne sans.",
  ),
  badOption: both('Unknown option: nothing sent.', 'Option inconnue : rien envoyé.'),
  badNumber: both(
    'The setpoint must be a number: nothing sent.',
    'La consigne doit être un nombre : rien envoyé.',
  ),
  badStep: both(
    'The setpoint must be a multiple of 0.1 °C: nothing sent.',
    'La consigne doit être un multiple de 0,1 °C : rien envoyé.',
  ),
  outOfRange: (min, max) =>
    both(
      `The setpoint must be between ${min} and ${max} °C: nothing sent.`,
      `La consigne doit être comprise entre ${min} et ${max} °C : rien envoyé.`,
    ),
  superseded: both(
    'Replaced by a newer command of the same feature: nothing sent.',
    'Remplacée par une commande plus récente de la même fonctionnalité : rien envoyé.',
  ),
  stopRunning: both(
    'A heating off is being written: try again in a few seconds. Nothing sent.',
    "Un arrêt du chauffage est en cours d'écriture : réessayez dans quelques secondes. Rien envoyé.",
  ),
  cancelledByStop: both(
    'Cancelled by a heating off asked meanwhile: nothing sent.',
    'Annulée par un arrêt du chauffage demandé entre-temps : rien envoyé.',
  ),
  noIdentity: both(
    'The controller has not been read yet: nothing sent.',
    "Le régulateur n'a pas encore été lu : rien envoyé.",
  ),
  otherController: both(
    'The controller answering does not show the display software version read before: nothing sent.',
    "Le régulateur qui répond n'a pas la version du logiciel de l'écran lue auparavant : rien envoyé.",
  ),
  unknownState: (reason) =>
    both(
      `The controller could not be read just before (${reason}): nothing sent.`,
      `Le régulateur n'a pas pu être relu juste avant (${reason}) : rien envoyé.`,
    ),
  tooSlow: both(
    'The controller answered too slowly to send the command in time: nothing sent.',
    'Le régulateur a répondu trop lentement pour envoyer la commande à temps : rien envoyé.',
  ),
  notSent: (reason) =>
    both(
      `The controller could not be reached (${reason}): nothing sent.`,
      `Le régulateur n'a pas pu être joint (${reason}) : rien envoyé.`,
    ),
  refused: (reason) =>
    both(
      `The controller refused the command (${reason}).`,
      `Le régulateur a refusé la commande (${reason}).`,
    ),
  sentUnconfirmed: (reason) =>
    both(
      `Command sent, without acknowledgement (${reason}): written again within a minute.`,
      `Commande envoyée, sans acquittement (${reason}) : réécrite dans la minute.`,
    ),
  storeFailed: both(
    'The state file in /data could not be written: nothing changed.',
    "Le fichier d'état dans /data n'a pas pu être écrit : rien n'a changé.",
  ),
  stopNotYet: both(
    'Heating off recorded, not yet acknowledged by the controller: written again every 15 s until it is.',
    "Arrêt du chauffage enregistré, pas encore acquitté par le régulateur : réécrit toutes les 15 s jusqu'à ce qu'il le soit.",
  ),
};
