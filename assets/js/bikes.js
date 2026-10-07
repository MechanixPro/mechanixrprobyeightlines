/* Mechanix Pro — popular two-wheeler models sold in India.
   Each row: [model, type, big]  type: m = motorcycle, s = scooter, e = electric.  big: 1 = above 180cc (or heavy EV/cruiser class).
   Customers can always type a model that is not listed. Add models here; no build step needed. */
window.MXP_BIKES = {
  'Honda': [['Activa 6G', 's', 0], ['Activa 125', 's', 0], ['Dio', 's', 0], ['Dio 125', 's', 0], ['Grazia 125', 's', 0], ['Shine 100', 'm', 0], ['Shine 125', 'm', 0], ['SP 125', 'm', 0], ['Livo', 'm', 0], ['Unicorn', 'm', 0], ['Hornet 2.0', 'm', 0], ['CB200X', 'm', 1], ['CB300F', 'm', 1], ['H’ness CB350', 'm', 1], ['CB350RS', 'm', 1]],
  'Hero': [['Splendor Plus', 'm', 0], ['Super Splendor', 'm', 0], ['HF Deluxe', 'm', 0], ['Passion Pro', 'm', 0], ['Glamour', 'm', 0], ['Xtreme 125R', 'm', 0], ['Xtreme 160R', 'm', 0], ['Xpulse 200', 'm', 1], ['Karizma XMR', 'm', 1], ['Destini 125', 's', 0], ['Pleasure Plus', 's', 0], ['Maestro Edge 125', 's', 0], ['Xoom', 's', 0], ['Vida V1', 'e', 0]],
  'TVS': [['Jupiter', 's', 0], ['Jupiter 125', 's', 0], ['Ntorq 125', 's', 0], ['Scooty Pep+', 's', 0], ['Scooty Zest', 's', 0], ['Radeon', 'm', 0], ['Sport', 'm', 0], ['Star City+', 'm', 0], ['Raider 125', 'm', 0], ['Apache RTR 160', 'm', 0], ['Apache RTR 160 4V', 'm', 0], ['Apache RTR 180', 'm', 0], ['Apache RTR 200 4V', 'm', 1], ['Ronin', 'm', 1], ['Apache RR 310', 'm', 1], ['iQube', 'e', 0]],
  'Bajaj': [['Platina 100', 'm', 0], ['Platina 110', 'm', 0], ['CT 100', 'm', 0], ['CT 110X', 'm', 0], ['Pulsar 125', 'm', 0], ['Pulsar 150', 'm', 0], ['Pulsar N150', 'm', 0], ['Pulsar N160', 'm', 0], ['Pulsar NS160', 'm', 0], ['Pulsar NS200', 'm', 1], ['Pulsar 220F', 'm', 1], ['Pulsar N250', 'm', 1], ['Avenger Street 160', 'm', 0], ['Avenger Cruise 220', 'm', 1], ['Dominar 250', 'm', 1], ['Dominar 400', 'm', 1], ['Chetak', 'e', 0]],
  'Royal Enfield': [['Classic 350', 'm', 1], ['Bullet 350', 'm', 1], ['Hunter 350', 'm', 1], ['Meteor 350', 'm', 1], ['Thunderbird 350', 'm', 1], ['Himalayan 411', 'm', 1], ['Himalayan 450', 'm', 1], ['Scram 411', 'm', 1], ['Guerrilla 450', 'm', 1], ['Interceptor 650', 'm', 1], ['Continental GT 650', 'm', 1], ['Super Meteor 650', 'm', 1], ['Shotgun 650', 'm', 1]],
  'Yamaha': [['FZ-S Fi', 'm', 0], ['FZ-X', 'm', 0], ['MT-15', 'm', 0], ['R15', 'm', 0], ['Fascino 125', 's', 0], ['RayZR 125', 's', 0], ['Aerox 155', 's', 0]],
  'Suzuki': [['Access 125', 's', 0], ['Burgman Street', 's', 0], ['Avenis', 's', 0], ['Gixxer', 'm', 0], ['Gixxer SF', 'm', 0], ['Intruder', 'm', 0], ['Gixxer 250', 'm', 1], ['V-Strom SX', 'm', 1]],
  'KTM': [['Duke 125', 'm', 0], ['RC 125', 'm', 0], ['Duke 200', 'm', 1], ['RC 200', 'm', 1], ['Duke 250', 'm', 1], ['Duke 390', 'm', 1], ['RC 390', 'm', 1], ['Adventure 250', 'm', 1], ['Adventure 390', 'm', 1]],
  'Ather': [['450X', 'e', 0], ['450S', 'e', 0], ['450 Apex', 'e', 0], ['Rizta', 'e', 0]],
  'Ola Electric': [['S1 Pro', 'e', 0], ['S1 Air', 'e', 0], ['S1 X', 'e', 0]],
  'Jawa / Yezdi': [['Jawa 42', 'm', 1], ['Jawa 350', 'm', 1], ['Jawa Perak', 'm', 1], ['Yezdi Roadster', 'm', 1], ['Yezdi Adventure', 'm', 1], ['Yezdi Scrambler', 'm', 1]],
  'Other': []
};
