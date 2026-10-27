# Pompes à chaleur CTC dans Gladys

Cette intégration affiche une pompe à chaleur CTC (EcoZenith i255, i360 ou
i550, EcoHeat, EcoPart, et l'EcoAir qu'ils pilotent) dans Gladys, par
l'interface **Modbus TCP** de son écran, sur votre réseau local, sans cloud.

Jamais testé avec un vrai CTC : elle suit le manuel BMS de CTC (162 600 16-3,
2026-02-02) et l'intégration HA-CTC-Local-Easyconf pour Home Assistant, qui
tourne sur de vraies installations. Sans lien avec CTC.

## Avant de commencer

1. Un écran à **3 ports** (le manuel : seuls ceux-là parlent Modbus en TCP/IP).
2. Sur l'écran : **Installateur** (Avancé), **Définir**, **Commande à
   distance**, réglez **Ethernet** sur **Modbus TCP**. Ce réglage exclurait
   la connexion au cloud myUplink.
3. Donnez à l'écran une adresse fixe dans votre routeur.
4. Le régulateur ne sert **qu'un client Modbus** à la fois : retirez tout
   autre client (Home Assistant, un script), sinon les deux échouent.
5. Modbus n'a pas de mot de passe : qui atteint le port 502 peut lire les
   registres et écrire ceux de pilotage. Gardez la pompe à chaleur sur un
   **réseau de confiance** (un VLAN, ou une règle de pare-feu qui ne laisse
   passer que Gladys), et n'ouvrez pas le port 502 sur internet.

## Configuration

| Champ                          | Rôle                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| Adresse IP de l'écran CTC      | Une adresse IPv4 ou un nom d'hôte, port 502 sauf si vous en ajoutez un (`192.168.1.80:5020`). |
| Autoriser les commandes        | Désactivé par défaut. Voir « Pilotage » plus bas.                                             |
| Intervalle de rafraîchissement | 30 s par défaut, de 10 à 600 s.                                                               |
| Langue                         | Noms de l'appareil et des fonctionnalités ajoutés désormais, textes des états, erreurs.       |

Enregistrez, puis ajoutez la pompe à chaleur depuis l'onglet **Découverte**.

Le bouton **Tester la connexion** lit le régulateur, au plus une fois par
intervalle de rafraîchissement, et affiche son état.

## Ce que vous obtenez

Températures (extérieure, départ et sa consigne, retour, eau des radiateurs,
entrée et sortie de la pompe à chaleur, gaz de refoulement et d'aspiration,
eau glycolée, eau chaude haut et bas, pièce 1 et 2), haute et basse
pression, vitesse du compresseur, pompe de charge, pompe d'eau glycolée et
ventilateur (%), degrés-minutes, puissance de la résistance, courants des
phases, capacité d'eau chaude, temps de fonctionnement du compresseur et ses
dernières 24 h, compteurs d'énergie de la résistance et du compresseur (kWh,
valeurs simples), états du système, de la pompe à chaleur, du circuit 1 et
du SmartGrid, et en lecture seule le mode d'eau chaude, le réglage de la
pièce et le mode de chauffage du circuit 1 mémorisés. Compresseur en marche,
dégivrage et « arrêtée par une alarme » viennent de l'état de la pompe à
chaleur.

Une valeur apparaît dès que son registre a répondu par un nombre. CTC répond
« pas de sonde » par des marqueurs (9999, 32767...) et se tait pour un
registre que le modèle n'a pas : un tel bloc est ignoré après trois lectures
muettes, jusqu'au redémarrage de l'intégration, et l'écran de configuration
le signale.

Les compteurs d'énergie sont des valeurs simples, pas un index d'énergie :
rien ne prouve encore qu'ils ne reculent ni ne sautent.

## Pilotage

Gladys n'écrit que dans les **registres de pilotage volatils** de CTC (le
bloc 1000), pas dans les réglages mémorisés, dont la mémoire supporte un
nombre limité d'écritures ; le code refuse toute autre adresse avant
d'envoyer quoi que ce soit. Le régulateur oublie une valeur de pilotage **5
minutes** après la dernière écriture et à son propre redémarrage : Gladys
réécrit donc ce qu'elle tient chaque minute. Si l'intégration s'arrête, la
pompe à chaleur reprend ses propres réglages sous 5 minutes.

Trois commandes :

- **Mode du circuit 1** : _Programme du régulateur_ (rend la main, n'écrit
  rien), _Chauffage arrêté_, _Chauffage_, _Auto_.
- **Mode de l'eau chaude** : _Programme du régulateur_, _Économie_,
  _Normal_, _Confort_. Les températures de ces modes sont les réglages du
  régulateur : Gladys n'écrit aucune température d'eau chaude.
- **Consigne de la pièce, circuit 1** : 10 à 30 °C, au dixième de degré.

Quand rien n'est en vigueur (rien de tenu, ou une tenue que le régulateur
n'acquitte plus), les commandes montrent ce que suit le régulateur : son
propre programme, son propre réglage de la pièce. La fonctionnalité
**Pilotage tenu par Gladys** dit ce qui est tenu et depuis quand, ce qui est
demandé sans être en vigueur, et la dernière tenue terminée.

### Comment une tenue se termine

Ce que Gladys tient (l'arrêt du chauffage compris) se termine :

- **à l'écran du régulateur** : changez le réglage correspondant (mode de
  chauffage du circuit 1 pour le mode du circuit et l'arrêt, réglage de la
  pièce du circuit 1, mode de l'eau chaude). Gladys note ces réglages une
  fois sa valeur acquittée et rend la tenue dès que l'un d'eux change (un
  réglage qu'elle ne peut lire ne rend rien) ;
- **au bout de 24 heures**, d'elle-même ;
- avec _Programme du régulateur_ ou le bouton **Rendre la main à la pompe à
  chaleur** (pour l'arrêt : seulement avec « Autoriser les commandes ») ;
- quand « Autoriser les commandes » est désactivé (sauf l'arrêt), quand la
  version du logiciel de l'écran change, ou quand le régulateur refuse une
  valeur (sauf l'arrêt) ;
- en dernier recours, en remettant Ethernet sur autre chose que Modbus TCP à
  l'écran, ou en arrêtant l'intégration : le régulateur oublie sous 5
  minutes.

On ne sait pas si l'écran ou le bloc 1000 l'emporte pendant que Gladys
tient une valeur (jamais testé avec un vrai CTC).

### Chauffage arrêté

_Chauffage arrêté_ (mode de zone du circuit 1 = arrêt) est la commande
protectrice. Elle fonctionne **même si « Autoriser les commandes » est
désactivé**, tant que le régulateur n'a pas encore été lu, après une lecture
en échec, et quand `/data` ne peut être écrit. Elle ne passe pas derrière
les lectures en file : elle attend seulement la fin de la requête Modbus en
cours (sa réponse, ou 5 s de silence : CTC ne traite qu'une requête à la
fois), puis part la première.

Elle n'est refusée que si aucune adresse de régulateur n'est connue : ni
dans la configuration, ni gardée dans `/data` (l'adresse de l'arrêt, ou la
dernière adresse où un CTC a été identifié). Tant que la configuration n'a
pas été lue depuis Gladys (elle est relue toutes les 5 s, délai doublé
jusqu'à 5 minutes, tant que Gladys ne répond pas), elle l'attend jusqu'à
2,5 s, puis prend l'adresse gardée dans `/data`.

Elle est gardée dans `/data` avec son adresse et sa date : après un
redémarrage de l'intégration, elle est réécrite aussitôt, avant même la
lecture de la configuration, sauf si elle a plus de 24 heures. Quand la
configuration donne une nouvelle adresse, elle n'y est écrite qu'une fois
un CTC identifié à cette adresse.

Si le régulateur ne l'acquitte pas sous 3,5 s, Gladys répond qu'elle est
enregistrée et pas encore acquittée ; s'il la refuse (exception Modbus 1, 2
ou 3), Gladys le dit. Dans les deux cas elle est gardée et réessayée : après
15 s, puis deux fois plus tard à chaque fois, jusqu'à 5 minutes (30 minutes
après un refus). Une fois acquittée, elle est réécrite chaque minute.

Un mode plus récent (_Chauffage_, _Auto_) la remplace une fois son écriture
partie ; `/data` est écrit avant. Si le régulateur refuse ce mode, l'arrêt
reste. Une commande demandée avant l'arrêt et pas encore envoyée est
annulée.

On ne sait pas si CTC garde sa protection contre le gel en mode de zone
arrêt : vérifiez-le sur votre installation avant de vous y fier en hiver.

### Les autres commandes

Elles demandent **Autoriser les commandes**. Avant chaque écriture, Gladys
relit la version du logiciel de l'écran dans la même session Modbus et
refuse si elle manque ou diffère de celle lue auparavant (un autre
régulateur à cette adresse). L'écriture doit partir dans les 3,5 s qui
suivent le clic, sinon rien n'est envoyé. Plusieurs commandes à la fois (une
scène) sont écrites l'une après l'autre, dans l'ordre ; un clic plus récent
sur la même fonctionnalité remplace un clic plus ancien pas encore envoyé.
Une écriture acquittée par le régulateur est tenue ; une écriture sans
réponse est signalée « envoyée, sans acquittement » et réécrite dans la
minute ; une écriture refusée par le régulateur n'est pas tenue. Aucune
n'est réécrite après un redémarrage de l'intégration : le régulateur les
oublie sous 5 minutes.

Les registres de pilotage ne se relisent pas (le manuel : écriture seule) :
l'acquittement du régulateur est la confirmation que Gladys peut donner. Les
états (circuit de chauffage 1, pompe à chaleur) montrent l'effet.

## Pas (encore) fait

La consigne d'eau chaude (registre 1033 : le manuel ne donne pas d'échelle
pour le bloc 1000, une erreur pourrait surchauffer l'eau), les circuits 2 à
4, le rafraîchissement, les limites de la résistance et du compresseur, les
entrées SmartGrid, les codes d'alarme (65xxx), l'interface web de l'écran.
