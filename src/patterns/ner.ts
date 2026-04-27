import { splitIdentifier } from '../shared.js';
import { normalizeForDetection, mapMatchToOriginal } from './normalize.js';

export interface NameMatch {
  name: string;
  offset: number;
  length: number;
  confidence: number;
}

// First names: German, English, Turkish, Arabic, Polish, Italian, Indian.
// Covers ~90% of encounters in international enterprise codebases.
const FIRST_NAMES = new Set([
  // Male
  'Alexander',
  'Andreas',
  'Anton',
  'Artur',
  'Axel',
  'Benjamin',
  'Bernd',
  'Bernhard',
  'Boris',
  'Bruno',
  'Carl',
  'Carlo',
  'Carsten',
  'Christian',
  'Christoph',
  'Christopher',
  'Claus',
  'Daniel',
  'David',
  'Dennis',
  'Dieter',
  'Dirk',
  'Dominik',
  'Eduard',
  'Elias',
  'Emil',
  'Erik',
  'Ernst',
  'Erwin',
  'Fabian',
  'Felix',
  'Ferdinand',
  'Finn',
  'Florian',
  'Frank',
  'Franz',
  'Friedrich',
  'Fritz',
  'Georg',
  'Gerhard',
  'Gregor',
  'Günter',
  'Günther',
  'Gustav',
  'Hans',
  'Harald',
  'Hartmut',
  'Heinrich',
  'Helmut',
  'Hendrik',
  'Henrik',
  'Herbert',
  'Hermann',
  'Holger',
  'Horst',
  'Hugo',
  'Ingo',
  'Ivan',
  'Jakob',
  'Jan',
  'Jens',
  'Joachim',
  'Jochen',
  'Johann',
  'Johannes',
  'Jonas',
  'Jonathan',
  'Josef',
  'Julian',
  'Julius',
  'Jürgen',
  'Kai',
  'Karl',
  'Karsten',
  'Klaus',
  'Konrad',
  'Kurt',
  'Lars',
  'Leo',
  'Leon',
  'Leonard',
  'Leonhard',
  'Lorenz',
  'Lothar',
  'Louis',
  'Luca',
  'Ludwig',
  'Luis',
  'Lukas',
  'Lutz',
  'Manfred',
  'Manuel',
  'Marc',
  'Marcel',
  'Marco',
  'Marcus',
  'Mario',
  'Markus',
  'Martin',
  'Mathias',
  'Matthias',
  'Max',
  'Maximilian',
  'Michael',
  'Moritz',
  'Nico',
  'Nicolas',
  'Niklas',
  'Nikolaus',
  'Nils',
  'Noah',
  'Norbert',
  'Oliver',
  'Oscar',
  'Oskar',
  'Otto',
  'Patrick',
  'Paul',
  'Peter',
  'Philipp',
  'Rafael',
  'Rainer',
  'Ralf',
  'Reinhard',
  'Reinhold',
  'René',
  'Richard',
  'Robert',
  'Robin',
  'Roland',
  'Rolf',
  'Roman',
  'Rudolf',
  'Rüdiger',
  'Samuel',
  'Sascha',
  'Sebastian',
  'Siegfried',
  'Simon',
  'Stefan',
  'Steffen',
  'Stephan',
  'Sven',
  'Theodor',
  'Thomas',
  'Thorsten',
  'Til',
  'Till',
  'Tilo',
  'Tim',
  'Timo',
  'Tobias',
  'Torsten',
  'Udo',
  'Ulrich',
  'Uwe',
  'Valentin',
  'Viktor',
  'Volker',
  'Walter',
  'Werner',
  'Wilhelm',
  'Willi',
  'Wolfgang',

  // Female
  'Adelheid',
  'Agnes',
  'Alexandra',
  'Alina',
  'Amelie',
  'Andrea',
  'Angelika',
  'Anika',
  'Anja',
  'Anna',
  'Annalena',
  'Anne',
  'Anneliese',
  'Annette',
  'Antje',
  'Astrid',
  'Barbara',
  'Beate',
  'Bianca',
  'Birgit',
  'Brigitte',
  'Britta',
  'Carla',
  'Carmen',
  'Caroline',
  'Charlotte',
  'Christa',
  'Christina',
  'Christine',
  'Clara',
  'Claudia',
  'Cornelia',
  'Dagmar',
  'Dana',
  'Daniela',
  'Diana',
  'Doris',
  'Dorothea',
  'Edith',
  'Elena',
  'Elfriede',
  'Elisabeth',
  'Elke',
  'Ella',
  'Emilia',
  'Emma',
  'Erika',
  'Erna',
  'Eva',
  'Franziska',
  'Freya',
  'Frieda',
  'Friederike',
  'Gabriele',
  'Gerda',
  'Gertrud',
  'Gisela',
  'Greta',
  'Gudrun',
  'Hanna',
  'Hannah',
  'Hannelore',
  'Heide',
  'Heidi',
  'Heike',
  'Helene',
  'Helga',
  'Hildegard',
  'Ilona',
  'Ilse',
  'Ina',
  'Ines',
  'Ingrid',
  'Irene',
  'Iris',
  'Isabel',
  'Isolde',
  'Jana',
  'Janina',
  'Jasmin',
  'Jennifer',
  'Jessica',
  'Johanna',
  'Julia',
  'Juliane',
  'Karin',
  'Karla',
  'Karolina',
  'Katarina',
  'Katharina',
  'Kathrin',
  'Katja',
  'Kerstin',
  'Klara',
  'Kristin',
  'Laura',
  'Lena',
  'Leonie',
  'Liane',
  'Lina',
  'Linda',
  'Lisa',
  'Lotte',
  'Luisa',
  'Luise',
  'Madeleine',
  'Magdalena',
  'Manuela',
  'Margarete',
  'Maria',
  'Marie',
  'Marina',
  'Marion',
  'Marlene',
  'Martha',
  'Martina',
  'Mathilde',
  'Meike',
  'Melanie',
  'Michaela',
  'Miriam',
  'Monika',
  'Nadine',
  'Natascha',
  'Nicole',
  'Nina',
  'Nora',
  'Olga',
  'Patricia',
  'Pauline',
  'Petra',
  'Pia',
  'Rebecca',
  'Regina',
  'Renate',
  'Rita',
  'Rosa',
  'Rosemarie',
  'Ruth',
  'Sabine',
  'Sandra',
  'Sara',
  'Sarah',
  'Sigrid',
  'Silke',
  'Simone',
  'Sofia',
  'Sonja',
  'Sophia',
  'Sophie',
  'Stefanie',
  'Stephanie',
  'Susanne',
  'Sylvia',
  'Tanja',
  'Teresa',
  'Theresa',
  'Tina',
  'Ulrike',
  'Ursula',
  'Ute',
  'Vanessa',
  'Vera',
  'Veronika',
  'Victoria',
  'Waltraud',
  'Wiebke',

  // Common English first names (overlap with international teams)
  'Adam',
  'Alice',
  'Amanda',
  'Amy',
  'Andrew',
  'Angela',
  'Anthony',
  'Ashley',
  'Brian',
  'Bruce',
  'Catherine',
  'Charles',
  'Chris',
  'Colin',
  'Craig',
  'Deborah',
  'Donald',
  'Dorothy',
  'Douglas',
  'Edward',
  'Elizabeth',
  'Emily',
  'Eric',
  'Ethan',
  'George',
  'Grace',
  'Gregory',
  'Harold',
  'Harry',
  'Helen',
  'Henry',
  'Jack',
  'Jacob',
  'James',
  'Jane',
  'Jason',
  'Jeffrey',
  'Jennifer',
  'Jeremy',
  'Jessica',
  'Joan',
  'Joe',
  'John',
  'Joseph',
  'Joshua',
  'Justin',
  'Karen',
  'Katherine',
  'Keith',
  'Kelly',
  'Kenneth',
  'Kevin',
  'Kyle',
  'Lauren',
  'Lawrence',
  'Lily',
  'Logan',
  'Margaret',
  'Mark',
  'Mary',
  'Mason',
  'Matthew',
  'Megan',
  'Melissa',
  'Michelle',
  'Nancy',
  'Nathan',
  'Nicholas',
  'Noah',
  'Olivia',
  'Oscar',
  'Pamela',
  'Patricia',
  'Philip',
  'Rachel',
  'Raymond',
  'Rebecca',
  'Richard',
  'Ronald',
  'Russell',
  'Ryan',
  'Samantha',
  'Sandra',
  'Scott',
  'Sharon',
  'Sophia',
  'Stephen',
  'Steven',
  'Susan',
  'Taylor',
  'Timothy',
  'Tyler',
  'Victoria',
  'Virginia',
  'William',

  // Turkish
  'Ahmet',
  'Ali',
  'Ayşe',
  'Burak',
  'Cem',
  'Deniz',
  'Elif',
  'Emine',
  'Emre',
  'Fatma',
  'Gül',
  'Hakan',
  'Hasan',
  'Hüseyin',
  'Kemal',
  'Leyla',
  'Mehmet',
  'Murat',
  'Mustafa',
  'Neslihan',
  'Nur',
  'Oğuz',
  'Ömer',
  'Özlem',
  'Recep',
  'Selim',
  'Serkan',
  'Sibel',
  'Sümeyye',
  'Tuncay',
  'Ümit',
  'Yasemin',
  'Yusuf',
  'Zeynep',

  // Arabic
  'Abdul',
  'Abdullah',
  'Ahmad',
  'Ahmed',
  'Aisha',
  'Amina',
  'Amir',
  'Farid',
  'Fatima',
  'Habib',
  'Hamid',
  'Hassan',
  'Hussain',
  'Ibrahim',
  'Jamal',
  'Karim',
  'Khalid',
  'Layla',
  'Mahmoud',
  'Mariam',
  'Mohammed',
  'Mostafa',
  'Nadia',
  'Nasser',
  'Omar',
  'Rashid',
  'Samir',
  'Tariq',
  'Yasmin',
  'Youssef',
  'Zainab',

  // Polish
  'Agnieszka',
  'Andrzej',
  'Beata',
  'Dariusz',
  'Dorota',
  'Ewa',
  'Grzegorz',
  'Iwona',
  'Jakub',
  'Janusz',
  'Joanna',
  'Katarzyna',
  'Krzysztof',
  'Łukasz',
  'Małgorzata',
  'Marcin',
  'Marek',
  'Mariusz',
  'Mateusz',
  'Paweł',
  'Piotr',
  'Rafał',
  'Stanisław',
  'Tomasz',
  'Wojciech',
  'Zbigniew',

  // Italian
  'Alessandro',
  'Alessia',
  'Chiara',
  'Davide',
  'Federica',
  'Francesca',
  'Giacomo',
  'Giorgio',
  'Giovanni',
  'Giuseppe',
  'Giulia',
  'Lucia',
  'Luigi',
  'Matteo',
  'Paola',
  'Paolo',
  'Roberto',
  'Salvatore',
  'Simone',
  'Stefano',
  'Valentina',

  // Indian
  'Aditya',
  'Amit',
  'Anil',
  'Anita',
  'Arjun',
  'Deepak',
  'Divya',
  'Ganesh',
  'Hari',
  'Kavita',
  'Krishna',
  'Lakshmi',
  'Manoj',
  'Neha',
  'Priya',
  'Rahul',
  'Rajesh',
  'Ravi',
  'Rohit',
  'Sachin',
  'Sandeep',
  'Sanjay',
  'Shivani',
  'Sunil',
  'Sunita',
  'Suresh',
  'Vijay',
  'Vikram',
  'Vinod',
]);

// Last names: German, English, Turkish, Arabic, Polish, Italian, Indian.
const LAST_NAMES = new Set([
  'Abel',
  'Ackermann',
  'Adam',
  'Adler',
  'Albrecht',
  'Alt',
  'Altmann',
  'Ammann',
  'Bach',
  'Bachmann',
  'Bader',
  'Bahr',
  'Bartels',
  'Barth',
  'Bartsch',
  'Basler',
  'Bauer',
  'Baumann',
  'Baumgartner',
  'Beck',
  'Becker',
  'Beer',
  'Behrendt',
  'Behrens',
  'Beier',
  'Berger',
  'Bergmann',
  'Berndt',
  'Bernhardt',
  'Bertram',
  'Best',
  'Beyer',
  'Bischoff',
  'Bittner',
  'Blank',
  'Blum',
  'Bock',
  'Böhm',
  'Böhme',
  'Böttcher',
  'Brandt',
  'Braun',
  'Brendel',
  'Brinkmann',
  'Brock',
  'Brückner',
  'Brüggemann',
  'Brunner',
  'Büchner',
  'Bühler',
  'Burger',
  'Burkhardt',
  'Busch',
  'Busse',
  'Conrad',
  'Decker',
  'Diehl',
  'Dietrich',
  'Dittrich',
  'Döring',
  'Dorn',
  'Ebert',
  'Eckert',
  'Eder',
  'Ehlert',
  'Eichhorn',
  'Engel',
  'Engelhardt',
  'Erdmann',
  'Ernst',
  'Falk',
  'Fehr',
  'Feldmann',
  'Fiedler',
  'Fischer',
  'Fleischer',
  'Förster',
  'Frank',
  'Franke',
  'Franz',
  'Freund',
  'Frey',
  'Friedrich',
  'Fritsch',
  'Fritz',
  'Fuchs',
  'Funke',
  'Gärtner',
  'Geiger',
  'Geißler',
  'Gerber',
  'Gerlach',
  'Giese',
  'Glaser',
  'Götze',
  'Graf',
  'Greiner',
  'Grimm',
  'Groß',
  'Große',
  'Gruber',
  'Grün',
  'Günther',
  'Haas',
  'Haase',
  'Hagen',
  'Hahn',
  'Hammer',
  'Hanke',
  'Hansen',
  'Hartmann',
  'Hartung',
  'Haupt',
  'Hauser',
  'Heck',
  'Hein',
  'Heinrich',
  'Heinz',
  'Held',
  'Heller',
  'Henke',
  'Henkel',
  'Hennig',
  'Hentschel',
  'Herbert',
  'Hermann',
  'Herold',
  'Herrmann',
  'Herzog',
  'Heß',
  'Hesse',
  'Hildebrandt',
  'Hinz',
  'Hirsch',
  'Hoffmann',
  'Hofmann',
  'Hohmann',
  'Horn',
  'Huber',
  'Hummel',
  'Jacob',
  'Jäger',
  'Jahn',
  'Jakob',
  'Janssen',
  'John',
  'Jordan',
  'Jost',
  'Jung',
  'Junge',
  'Jungblut',
  'Junker',
  'Jürgens',
  'Kaiser',
  'Kappel',
  'Karl',
  'Kaufmann',
  'Keil',
  'Keller',
  'Kellner',
  'Kern',
  'Kessler',
  'Kirchner',
  'Klatt',
  'Klein',
  'Klemm',
  'Klose',
  'Kluge',
  'Knoll',
  'Koch',
  'König',
  'Körner',
  'Kraft',
  'Kramer',
  'Kraus',
  'Krause',
  'Kremer',
  'Kretschmer',
  'Krieger',
  'Kröger',
  'Kroll',
  'Krüger',
  'Kühn',
  'Kuhn',
  'Kunz',
  'Kunze',
  'Kurz',
  'Lang',
  'Lange',
  'Langer',
  'Lauer',
  'Lehmann',
  'Lehner',
  'Lenz',
  'Lindemann',
  'Lindner',
  'Link',
  'Lohmann',
  'Lorenz',
  'Ludwig',
  'Lüdtke',
  'Maier',
  'Mann',
  'Martin',
  'Marx',
  'Maurer',
  'May',
  'Mayer',
  'Meier',
  'Meister',
  'Menzel',
  'Merkel',
  'Mertens',
  'Merz',
  'Metz',
  'Meyer',
  'Michel',
  'Möller',
  'Mohr',
  'Moritz',
  'Müller',
  'Münch',
  'Nagel',
  'Naumann',
  'Neubert',
  'Neuhaus',
  'Neumann',
  'Niemann',
  'Noack',
  'Nolte',
  'Nowak',
  'Oertel',
  'Orth',
  'Otto',
  'Paul',
  'Peters',
  'Petersen',
  'Pfeifer',
  'Pfeiffer',
  'Pflüger',
  'Pohl',
  'Popp',
  'Preuß',
  'Raab',
  'Rapp',
  'Rau',
  'Rauch',
  'Reimann',
  'Reinhardt',
  'Reiter',
  'Renner',
  'Richter',
  'Riedel',
  'Rieger',
  'Ring',
  'Ritter',
  'Röder',
  'Roth',
  'Rudolph',
  'Ruf',
  'Sander',
  'Sauer',
  'Schäfer',
  'Schaller',
  'Scharf',
  'Scheffler',
  'Schenk',
  'Scherer',
  'Schiller',
  'Schilling',
  'Schlegel',
  'Schlüter',
  'Schmidt',
  'Schmidtke',
  'Schmitt',
  'Schmitz',
  'Schneider',
  'Scholz',
  'Schön',
  'Schreiber',
  'Schröder',
  'Schubert',
  'Schulte',
  'Schultz',
  'Schulz',
  'Schulze',
  'Schumacher',
  'Schuster',
  'Schwab',
  'Schwartz',
  'Schwarz',
  'Schweizer',
  'Seidel',
  'Seifert',
  'Siebert',
  'Siegmund',
  'Simon',
  'Singer',
  'Sommer',
  'Sonntag',
  'Stadler',
  'Stark',
  'Steffens',
  'Steiner',
  'Steinmann',
  'Stephan',
  'Stock',
  'Stoll',
  'Straub',
  'Strauss',
  'Strauß',
  'Thiel',
  'Thieme',
  'Thomas',
  'Timm',
  'Ullrich',
  'Ulrich',
  'Unger',
  'Vogt',
  'Voigt',
  'Volk',
  'Volkmann',
  'Voss',
  'Voß',
  'Wagner',
  'Walther',
  'Weber',
  'Wegner',
  'Weiß',
  'Weller',
  'Wendler',
  'Wendt',
  'Wenzel',
  'Werner',
  'Westphal',
  'Wiedemann',
  'Wiegand',
  'Wiese',
  'Wild',
  'Wilhelm',
  'Winkler',
  'Winter',
  'Wirth',
  'Witt',
  'Witte',
  'Wolf',
  'Wolff',
  'Wolter',
  'Wulf',
  'Wunderlich',
  'Zander',
  'Zeller',
  'Ziegler',
  'Zimmermann',
  'Zink',

  // Common English last names
  'Anderson',
  'Bailey',
  'Baker',
  'Barnes',
  'Bennett',
  'Brooks',
  'Brown',
  'Butler',
  'Campbell',
  'Carter',
  'Clark',
  'Clarke',
  'Collins',
  'Cook',
  'Cooper',
  'Cox',
  'Crawford',
  'Davis',
  'Dixon',
  'Edwards',
  'Ellis',
  'Evans',
  'Fisher',
  'Foster',
  'Fox',
  'Garcia',
  'Gibson',
  'Gordon',
  'Graham',
  'Grant',
  'Green',
  'Griffin',
  'Hall',
  'Hamilton',
  'Harris',
  'Harrison',
  'Harvey',
  'Henderson',
  'Hill',
  'Holmes',
  'Howard',
  'Hughes',
  'Hunt',
  'Hunter',
  'Jackson',
  'Jenkins',
  'Johnson',
  'Jones',
  'Kelly',
  'Kennedy',
  'King',
  'Knight',
  'Lawrence',
  'Lewis',
  'Lloyd',
  'Marshall',
  'Mason',
  'Miller',
  'Mills',
  'Mitchell',
  'Moore',
  'Morgan',
  'Morris',
  'Murphy',
  'Murray',
  'Nelson',
  'Newman',
  'Oliver',
  'Owen',
  'Palmer',
  'Parker',
  'Patterson',
  'Phillips',
  'Porter',
  'Powell',
  'Price',
  'Reed',
  'Reid',
  'Reynolds',
  'Richardson',
  'Riley',
  'Roberts',
  'Robertson',
  'Robinson',
  'Rogers',
  'Ross',
  'Russell',
  'Sanders',
  'Scott',
  'Shaw',
  'Simpson',
  'Smith',
  'Spencer',
  'Stevens',
  'Stewart',
  'Stone',
  'Sullivan',
  'Taylor',
  'Thompson',
  'Tucker',
  'Turner',
  'Walker',
  'Wallace',
  'Ward',
  'Warren',
  'Watson',
  'Webb',
  'Wells',
  'West',
  'White',
  'Williams',
  'Wilson',
  'Wood',
  'Wright',
  'Young',

  // Turkish
  'Aksoy',
  'Arslan',
  'Aydın',
  'Çelik',
  'Demir',
  'Doğan',
  'Erdoğan',
  'Güneş',
  'Kara',
  'Kaya',
  'Koç',
  'Korkmaz',
  'Öz',
  'Özdemir',
  'Özkan',
  'Öztürk',
  'Şahin',
  'Şen',
  'Toprak',
  'Türk',
  'Yıldırım',
  'Yıldız',
  'Yılmaz',

  // Arabic
  'Al-Ahmad',
  'Al-Ali',
  'Al-Hassan',
  'Al-Hussein',
  'Al-Rahman',
  'Al-Rashid',
  'El-Sayed',
  'Habib',
  'Ibrahim',
  'Mansour',
  'Nasser',
  'Said',
  'Saleh',

  // Polish
  'Baran',
  'Dąbrowski',
  'Grabowski',
  'Jabłoński',
  'Jankowski',
  'Kamiński',
  'Kowalczyk',
  'Kowalski',
  'Krawczyk',
  'Lewandowski',
  'Mazur',
  'Michalski',
  'Olszewski',
  'Pawlak',
  'Piotrowski',
  'Szymański',
  'Wiśniewski',
  'Wójcik',
  'Wojciechowski',
  'Woźniak',
  'Zieliński',

  // Italian
  'Bianchi',
  'Colombo',
  'Conti',
  'Costa',
  'DeLuca',
  'Esposito',
  'Ferrari',
  'Ferro',
  'Gallo',
  'Greco',
  'Leone',
  'Lombardi',
  'Mancini',
  'Marino',
  'Moretti',
  'Ricci',
  'Romano',
  'Rossi',
  'Russo',
  'Santoro',
  'Vitale',

  // Indian
  'Agarwal',
  'Banerjee',
  'Bhat',
  'Chakraborty',
  'Chatterjee',
  'Das',
  'Desai',
  'Ghosh',
  'Gupta',
  'Iyer',
  'Jain',
  'Joshi',
  'Kapoor',
  'Khan',
  'Kumar',
  'Malhotra',
  'Mehta',
  'Mishra',
  'Mukherjee',
  'Nair',
  'Patel',
  'Rao',
  'Reddy',
  'Shah',
  'Sharma',
  'Singh',
  'Srivastava',
  'Verma',
]);

// Words that look like names but are actually programming terms, brands, or common nouns.
// Overlaps with the openredaction-bridge blocklist but specifically for dictionary matching.
const BLOCKLIST = new Set([
  // Programming / tech that overlap with name sets
  'Adam',
  'Grace',
  'Ruby',
  'Iris',
  'Dawn',
  'Amber',
  'Jade',
  'Ivy',
  'Heath',
  'Grant',
  'Chase',
  'Hunter',
  'Mason',
  'Cooper',
  'Carter',
  'Parker',
  'Tyler',
  'Logan',
  'Taylor',
  'Reed',
  'Stone',
  'Fox',
  'Young',
  'King',
  'Knight',
  // Common in code context
  'Node',
  'Spring',
  'Express',
  'React',
  'Vue',
  'Angular',
  'Docker',
  'Kafka',
  'Oracle',
  'Lambda',
  'Delta',
  'Alpha',
  'Beta',
  'Gamma',
  'Sigma',
  'Omega',
  'Buffer',
  'Stream',
  'String',
  'Array',
  'Object',
  'Class',
  'Module',
  'Event',
  'Error',
  'Promise',
  'Proxy',
  'Handler',
  'Builder',
  'Factory',
  'Service',
  'Client',
  'Server',
  'Worker',
  'Manager',
  'Controller',
  'Provider',
  'Consumer',
  'Adapter',
  'Router',
  'Logger',
  'Mapper',
  'Parser',
  'Scanner',
  'Reader',
  'Writer',
  'Loader',
  'Finder',
  'Helper',
  'Wrapper',
  'Runner',
  'Driver',
  'Sender',
  'Receiver',
  'Plugin',
  'Config',
  'Context',
  'Resolver',
  'Validator',
  'Converter',
  'Iterator',
  'Generator',
  'Observer',
  'Listener',
  'Monitor',
  'Tracker',
  'Scheduler',
  'Dispatcher',
  'Interceptor',
  'Inspector',
  // Git / version control
  'Merge',
  'Branch',
  'Remote',
  'Origin',
  'Master',
  'Release',
  // Misc
  'Test',
  'Mock',
  'Stub',
  'Fake',
  'Dummy',
  'Default',
  'Custom',
  'Abstract',
  'Base',
  'Root',
  'Main',
  'Core',
  'Utils',
  'Util',
  'True',
  'False',
  'Null',
  'Void',
  'None',
  'North',
  'South',
  'East',
  'West',
  'Red',
  'Blue',
  'Black',
  'White',
  'Green',
  'Brown',
  'Grey',
  'Gray',
  'Jan',
  'Mar',
  'May',
  'Jun',
  'Jul',
  'Aug',
  // German titles / salutations (used as prefix triggers, not as names themselves)
  'Herr',
  'Frau',
  'Herrn',
  'Doktor',
  // German words that start uppercase (Das = also Indian surname, but too common as article)
  'Das',
  'Typ',
  'Art',
  'Feld',
  'Wert',
  'Klasse',
  'Schritt',
  'Teil',
  'Punkt',
  'Beginn',
  'Ende',
  'Start',
  'Status',
  'Phase',
  'Ebene',
  'Stufe',
  'Fehler',
  'Erfolg',
  'Hinweis',
  'Frage',
  'Antwort',
  'Lösung',
  'Aufgabe',
  'Name',
  'Datum',
  'Zeit',
  'Dauer',
  'Stelle',
  'Bereich',
  'Tabelle',
  'Spalte',
  'Zeile',
  'Nummer',
  'Betrag',
  'Adresse',
  'Standort',
  'Ergebnis',
  'Beispiel',
  'Muster',
  'Vorlage',
  'Grundlage',
]);

// Contextual prefixes that strongly indicate a following word is a person name.
const NAME_PREFIXES = [
  /\b(?:Herr|Frau|Hr\.|Fr\.)\s+/g,
  /\b(?:Dr\.|Prof\.|Ing\.)\s+/g,
  /\b(?:Author|Autor|Reviewer|Maintainer|Erstellt von|Geprüft von|Bearbeiter|Ansprechpartner|Kontakt|Verantwortlich):\s*/gi,
  /\b(?:Signed-off-by|Reported-by|Reviewed-by|Co-authored-by):\s*/gi,
  /\b(?:von|by|from)\s+(?=[A-ZÄÖÜŁŞİĞÇĆŃŹŻ\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Thai}\p{Script=Devanagari}])/gu,
  /(?:@author|@since|@reviewer)\s+/gi,
];

// Matches a run of letters from a non-latin script used for personal names.
// CJK / Korean / Japanese: short runs (1-6 chars). Arabic / Hebrew / Cyrillic
// / Thai / Devanagari: longer runs up to ~20 chars incl. optional spaces.
const NON_LATIN_NAME_RE =
  /^([\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]{2,8}|[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Thai}\p{Script=Devanagari}][\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Thai}\p{Script=Devanagari}\s]{1,25}[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Thai}\p{Script=Devanagari}])/u;

// Matches a capitalized word (German umlauts, Turkish ş/ı/ğ/ç, Polish ł/ą/ę/ź/ć/ń/ż/ó).
const CAP_WORD = /[A-ZÄÖÜŁŞİĞÇĆŃŹŻ][a-zäöüßşığçłąęźćńżó]+/;
const CAP_WORD_RE = new RegExp(CAP_WORD.source, 'g');

// Full name: "FirstName LastName" or "FirstName Al-LastName" with optional middle parts
const FULL_NAME_RE = new RegExp(
  `(${CAP_WORD.source})(?:\\s+${CAP_WORD.source})*\\s+(?:(?:Al|El)-)?(?:${CAP_WORD.source})`,
  'g',
);

function asciify(word: string): string {
  return word
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

const FIRST_NAMES_ASCII = new Set([...FIRST_NAMES].map(asciify));
const LAST_NAMES_ASCII = new Set([...LAST_NAMES].map(asciify));

// Common lowercase nouns from programming identifiers. Pass 3 rejects pairs
// where a half sits here. otherwise `max_price` (Max / Price) leaks.
const PROGRAMMING_NOUNS = new Set([
  'avg',
  'begin',
  'body',
  'col',
  'cost',
  'count',
  'data',
  'date',
  'delta',
  'diff',
  'end',
  'file',
  'first',
  'flag',
  'form',
  'hash',
  'head',
  'height',
  'id',
  'idx',
  'index',
  'int',
  'item',
  'key',
  'kind',
  'last',
  'length',
  'limit',
  'line',
  'list',
  'max',
  'mean',
  'min',
  'mode',
  'name',
  'new',
  'num',
  'offset',
  'old',
  'page',
  'path',
  'price',
  'rate',
  'row',
  'score',
  'size',
  'start',
  'state',
  'stats',
  'status',
  'stop',
  'str',
  'sum',
  'tax',
  'time',
  'total',
  'type',
  'user',
  'val',
  'value',
  'width',
]);

function isCapitalized(word: string): boolean {
  return /^[A-ZÄÖÜŁŞĞÇĆŃŹŻİ]/.test(word);
}

function looksLikeCamelCase(text: string, offset: number): boolean {
  if (offset === 0) return false;
  const prev = text[offset - 1];
  return /[a-zäöüßşığçłąęźćńżó]/.test(prev);
}

function isInsideCodeBlock(text: string, offset: number): boolean {
  const before = text.slice(Math.max(0, offset - 50), offset);
  const after = text.slice(offset, Math.min(text.length, offset + 80));

  // Count single backticks only. A fenced block (```python ... ```) puts the
  // name inside human-readable prose, not inside a code literal. suppressing
  // it here caused "# Maintainer: Artur Sommer" a few lines after ```python
  // to slip past the NER passes while "Sally Müller" further down, past the
  // 50-char sliding window, still got caught. Strip fences before counting.
  const withoutFences = before.replace(/```/g, '');
  const btBefore = (withoutFences.match(/`/g) || []).length;
  if (btBefore % 2 === 1) return true;

  if (/(?:class|interface|enum|function|const|let|var|type|import|export)\s+$/.test(before))
    return true;

  // Skip past the first token (latin CAP_WORD or run of non-latin letters)
  // before checking the follow-up character. This stays consistent across
  // scripts. CAP_WORD_RE alone would return undefined for CJK hits and miss
  // the method-call/generic signal.
  const latinToken = text.slice(offset).match(CAP_WORD_RE)?.[0];
  const nonLatinToken = text
    .slice(offset)
    .match(
      /^[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Ethiopic}\p{Script=Tamil}\p{Script=Bengali}\p{Script=Gujarati}][\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Ethiopic}\p{Script=Tamil}\p{Script=Bengali}\p{Script=Gujarati}\s]*/u,
    )?.[0];
  const tokenLen = Math.max(latinToken?.length ?? 0, nonLatinToken?.length ?? 0);
  if (/^[.(/<]/.test(after.slice(tokenLen))) return true;

  return false;
}

function isBlocklisted(word: string): boolean {
  return BLOCKLIST.has(word);
}

function isFirstName(word: string, ignoreBlocklist = false): boolean {
  if (!ignoreBlocklist && isBlocklisted(word)) return false;
  if (FIRST_NAMES.has(word)) return true;
  // Allow ASCII transliterations: "Mueller" matches "Müller", "Schroeder"
  // matches "Schröder". Covers identifier-embedded names where the source
  // lost its umlauts on the way into the codebase.
  return FIRST_NAMES_ASCII.has(asciify(word));
}

function isLastName(word: string, ignoreBlocklist = false): boolean {
  if (!ignoreBlocklist && isBlocklisted(word)) return false;
  if (LAST_NAMES.has(word)) return true;
  return LAST_NAMES_ASCII.has(asciify(word));
}

function hasLastNameSuffix(word: string): boolean {
  const suffixes = [
    'mann',
    'stein',
    'berg',
    'burg',
    'ner',
    'ler',
    'ger',
    'meyer',
    'meier',
    'maier',
    'müller',
    'mayer',
    'bauer',
    'huber',
    'feld',
    'dorf',
    'hof',
    'bach',
    'brück',
    'thal',
    'wald',
    'witz',
    'rath',
    'hagen',
    'kamp',
  ];
  const lower = word.toLowerCase();
  if (lower.length < 4) return false;
  return suffixes.some((s) => lower.endsWith(s) && lower.length > s.length + 1);
}

// Standalone non-latin name detection (no prefix required). Lower confidence
// than prefix-triggered matches. a japanese code comment or an arabic string
// literal could trigger these. Since we pseudonymize to generic tokens, over-
// matching is a usability tradeoff, not a data leak.
const HAN_RUN_RE = /(?<![\p{Script=Han}])(\p{Script=Han}{2,8})(?![\p{Script=Han}])/gu;
const HANGUL_RUN_RE = /(?<![\p{Script=Hangul}])(\p{Script=Hangul}{2,8})(?![\p{Script=Hangul}])/gu;
const HIRAGANA_RUN_RE =
  /(?<![\p{Script=Hiragana}])(\p{Script=Hiragana}{2,8})(?![\p{Script=Hiragana}])/gu;
const KATAKANA_RUN_RE =
  /(?<![\p{Script=Katakana}])(\p{Script=Katakana}{2,8})(?![\p{Script=Katakana}])/gu;
const ARABIC_RUN_RE =
  /(?<![\p{Script=Arabic}])(\p{Script=Arabic}[\p{Script=Arabic}\s]{2,18}\p{Script=Arabic})(?![\p{Script=Arabic}])/gu;
const HEBREW_RUN_RE =
  /(?<![\p{Script=Hebrew}])(\p{Script=Hebrew}[\p{Script=Hebrew}\s]{2,18}\p{Script=Hebrew})(?![\p{Script=Hebrew}])/gu;
const CYRILLIC_RUN_RE =
  /(?<![\p{Script=Cyrillic}])(\p{Script=Cyrillic}[\p{Script=Cyrillic}\s]{2,18}\p{Script=Cyrillic})(?![\p{Script=Cyrillic}])/gu;
const THAI_RUN_RE =
  /(?<![\p{Script=Thai}])(\p{Script=Thai}[\p{Script=Thai}\s]{2,18}\p{Script=Thai})(?![\p{Script=Thai}])/gu;
const DEVANAGARI_RUN_RE =
  /(?<![\p{Script=Devanagari}])(\p{Script=Devanagari}[\p{Script=Devanagari}\s]{2,18}\p{Script=Devanagari})(?![\p{Script=Devanagari}])/gu;

export interface DetectOptions {
  /** Skip the identifier-embedded-name scan (Pass 3). Heavy on large files;
   *  callers can opt out when the user configured `aggression: low`. */
  skipIdentifierScan?: boolean;
}

export function detectNames(text: string, opts?: DetectOptions): NameMatch[] {
  // Run passes on text where zero-width injection is neutralized. Secrets-
  // style strip (`api\u200B_key` → `api_key`) would concatenate tokens across
  // name boundaries (`Thomas\u200BMüller` → `ThomasMüller`), so here we
  // replace zero-width chars with a space instead. NFKC still neutralises
  // fullwidth prefixes like `Ａｕｔｈｏｒ`.
  const norm = normalizeForNer(text);
  if (norm.originalPos === undefined) return detectNamesOn(text, opts);
  const raw = detectNamesOn(norm.normalized, opts);
  return raw.map((h) => {
    const m = mapMatchToOriginal(norm, h.offset, h.length);
    // name comes from the normalized slice so the SessionMap key stays stable
    // when the same person reappears later as a clean repeat without ZWS
    // injection. offset/length still reference original text so the in-place
    // replacement correctly excises the ZWS-bearing region.
    return {
      ...h,
      name: norm.normalized.slice(h.offset, h.offset + h.length),
      offset: m.start,
      length: m.length,
    };
  });
}

const ZERO_WIDTH_NER = /[\u200B\u200C\u200D\uFEFF]/g;

function normalizeForNer(original: string): ReturnType<typeof normalizeForDetection> {
  if (!ZERO_WIDTH_NER.test(original) && original.normalize('NFKC') === original) {
    return { normalized: original, originalPos: undefined };
  }
  const out: string[] = [];
  const pos: number[] = [];
  for (let i = 0; i < original.length; i++) {
    const ch = original[i];
    if (ch === '\u200B' || ch === '\u200C' || ch === '\u200D' || ch === '\uFEFF') {
      out.push(' ');
      pos.push(i);
      continue;
    }
    const mapped = ch.normalize('NFKC');
    for (let j = 0; j < mapped.length; j++) {
      out.push(mapped[j]);
      pos.push(i);
    }
  }
  return { normalized: out.join(''), originalPos: pos };
}

interface StageAccumulator {
  hits: NameMatch[];
  covered: Array<[number, number]>;
}

function isAlreadyCovered(
  covered: Array<[number, number]>,
  offset: number,
  length: number,
): boolean {
  return covered.some(([s, e]) => offset >= s && offset + length <= e);
}

function markCovered(covered: Array<[number, number]>, offset: number, length: number): void {
  covered.push([offset, offset + length]);
}

export function runPrefixTriggerStage(text: string, acc: StageAccumulator): void {
  const { hits } = acc;
  const covered = acc.covered;
  for (const prefixRe of NAME_PREFIXES) {
    const re = new RegExp(prefixRe.source, prefixRe.flags);
    let pm: RegExpExecArray | null;

    while ((pm = re.exec(text)) !== null) {
      const afterPrefix = text.slice(pm.index + pm[0].length);
      const AL_PART = `(?:(?:Al|El)-)?${CAP_WORD.source}`;
      const latinMatch = afterPrefix.match(
        new RegExp(`^(${CAP_WORD.source}(?:\\s+${AL_PART}){0,3})`),
      );

      let fullName: string | undefined = latinMatch?.[1];
      if (!fullName) {
        // Fallback for non-latin scripts after the prefix: e.g. "Author: 山田太郎"
        // or "Kontakt: محمد الحسن". The local NER dictionaries cover German /
        // English / Turkish / Polish / Italian / Arabic-Latin already.
        const nonLatinMatch = afterPrefix.match(NON_LATIN_NAME_RE);
        if (nonLatinMatch) fullName = nonLatinMatch[1].trim();
      }

      if (!fullName) continue;

      const words = fullName.split(/\s+/);
      const originalLength = fullName.length;
      if (words.every((w) => isBlocklisted(w))) continue;
      // Strip trailing tech terms ("Registration Service", "Hans Delta Runner"):
      // the prefix trigger grabs the whole capitalized run, but a class/role
      // word at the tail is noise, not part of the name.
      const trimmed = [...words];
      while (trimmed.length > 1 && isBlocklisted(trimmed[trimmed.length - 1])) {
        trimmed.pop();
      }
      if (trimmed.every((w) => isBlocklisted(w))) continue;
      // Require at least one token to be a recognised first/last name. Without
      // this, "from Payment Pipeline" or "handled by the Request Storage" trip
      // the prefix trigger and leak with 0.9 confidence despite being pure
      // tech pairs. The BLOCKLIST alone is enumeration-fragile. too many
      // domain nouns ("Pipeline", "Storage", "Queue", …) to keep up with.
      const hasRecognisedName = trimmed.some(
        (w) => isFirstName(w) || isLastName(w) || hasLastNameSuffix(w),
      );
      if (!hasRecognisedName) continue;
      if (trimmed.length < words.length) fullName = trimmed.join(' ');

      const nameOffset = pm.index + pm[0].length;
      if (isInsideCodeBlock(text, nameOffset)) continue;

      const confidence = 0.9;
      hits.push({
        name: fullName,
        offset: nameOffset,
        length: fullName.length,
        confidence,
      });
      // Cover the ORIGINAL prefix-matched span so Pass 2 doesn't re-hit the
      // trimmed tail with lower confidence. Otherwise "Kontakt: Hans Delta
      // Runner" produces both "Hans@0.9" (Pass 1 trimmed) and
      // "Hans Delta Runner@0.85" (Pass 2 full-range).
      markCovered(covered, nameOffset, originalLength);
    }
  }
}

export function runDictionaryMatchStage(text: string, acc: StageAccumulator): void {
  const { hits, covered } = acc;
  const fullRe = new RegExp(FULL_NAME_RE.source, FULL_NAME_RE.flags);
  let fm: RegExpExecArray | null;
  while ((fm = fullRe.exec(text)) !== null) {
    const fullMatch = fm[0];
    const offset = fm.index;

    if (isAlreadyCovered(covered, offset, fullMatch.length)) continue;
    if (looksLikeCamelCase(text, offset)) continue;
    if (isInsideCodeBlock(text, offset)) continue;

    const words = fullMatch.split(/\s+/);
    const first = words[0];
    const last = words[words.length - 1];

    // Skip if all words are blocklisted
    if (words.every((w) => isBlocklisted(w))) continue;

    // Both first and last must be recognized
    const firstOk = isFirstName(first);
    const lastOk = isLastName(last) || hasLastNameSuffix(last);

    if (!firstOk && !lastOk) continue;

    let confidence: number;
    if (firstOk && lastOk) {
      confidence = 0.85;
    } else if (firstOk && isCapitalized(last) && !isBlocklisted(last)) {
      // Known first name + unknown but capitalized last name
      confidence = 0.7;
    } else if (lastOk && isCapitalized(first) && !isBlocklisted(first)) {
      // Unknown first name + known last name
      confidence = 0.7;
    } else {
      continue;
    }

    // Extra check: reject if the "name" is at the start of a sentence and
    // followed by a verb-like lowercase word - might just be a regular German sentence.
    // But only if neither word is in the dictionary at all.
    if (!firstOk && !lastOk) continue;

    hits.push({ name: fullMatch, offset, length: fullMatch.length, confidence });
    markCovered(covered, offset, fullMatch.length);

    // Reset regex index to right after first word to catch overlapping patterns.
    // +1 skips the whitespace separator between first name and last name so the
    // next match attempt starts at a real token boundary.
    fullRe.lastIndex = offset + first.length + 1;
  }

  // Pass 2b: strict 2-word pairs. Pass 2 greedy matched 3+ tokens and
  // rejected the whole span when ends were unknown, so "Clemens Kurz Customer"
  // never yielded the inner "Clemens Kurz".
  const pairRe = new RegExp(`(${CAP_WORD.source})\\s+(${CAP_WORD.source})`, 'g');
  let pm2: RegExpExecArray | null;
  while ((pm2 = pairRe.exec(text)) !== null) {
    const pairMatch = pm2[0];
    const offset = pm2.index;
    if (isAlreadyCovered(covered, offset, pairMatch.length)) {
      pairRe.lastIndex = offset + pm2[1].length + 1;
      continue;
    }
    if (looksLikeCamelCase(text, offset)) {
      pairRe.lastIndex = offset + pm2[1].length + 1;
      continue;
    }
    if (isInsideCodeBlock(text, offset)) {
      pairRe.lastIndex = offset + pm2[1].length + 1;
      continue;
    }
    const first = pm2[1];
    const last = pm2[2];
    if (isBlocklisted(first) && isBlocklisted(last)) {
      pairRe.lastIndex = offset + first.length + 1;
      continue;
    }
    const firstOk = isFirstName(first);
    const lastOk = isLastName(last) || hasLastNameSuffix(last);
    let confidence: number;
    if (firstOk && lastOk) {
      confidence = 0.85;
    } else if (firstOk && isCapitalized(last) && !isBlocklisted(last)) {
      confidence = 0.7;
    } else if (lastOk && isCapitalized(first) && !isBlocklisted(first)) {
      confidence = 0.7;
    } else {
      pairRe.lastIndex = offset + first.length + 1;
      continue;
    }
    hits.push({ name: pairMatch, offset, length: pairMatch.length, confidence });
    markCovered(covered, offset, pairMatch.length);
    pairRe.lastIndex = offset + first.length + 1;
  }
}

export function runCamelCaseSplitStage(text: string, acc: StageAccumulator): void {
  const { hits, covered } = acc;
  const identifierRe = /\b[A-Za-z][A-Za-z0-9_-]{5,}[A-Za-z0-9]\b/g;
  let im: RegExpExecArray | null;
  while ((im = identifierRe.exec(text)) !== null) {
    const id = im[0];
    if (!/[a-z][A-Z]/.test(id) && !/[A-Z][a-z]+[A-Z]/.test(id) && !/[_-]/.test(id)) continue;

    const parts = splitIdentifier(id);
    if (parts.length < 2) continue;

    const cap = (s: string): string => (s[0] ? s[0].toUpperCase() + s.slice(1) : s);
    let matched = false;
    for (let i = 0; i < parts.length - 1; i++) {
      const rawA = parts[i];
      const rawB = parts[i + 1];
      if (PROGRAMMING_NOUNS.has(rawA.toLowerCase()) || PROGRAMMING_NOUNS.has(rawB.toLowerCase())) {
        continue;
      }
      const a = cap(rawA);
      const b = cap(rawB);
      if (
        (isFirstName(a, true) && (isLastName(b, true) || hasLastNameSuffix(b))) ||
        (isFirstName(b, true) && (isLastName(a, true) || hasLastNameSuffix(a)))
      ) {
        matched = true;
        break;
      }
    }
    if (!matched) continue;

    const offset = im.index;
    if (isAlreadyCovered(covered, offset, id.length)) continue;

    hits.push({ name: id, offset, length: id.length, confidence: 0.75 });
    markCovered(covered, offset, id.length);
  }
}

export function runNonLatinRunStage(text: string, acc: StageAccumulator): void {
  const { hits, covered } = acc;
  for (const re of [
    HAN_RUN_RE,
    HANGUL_RUN_RE,
    HIRAGANA_RUN_RE,
    KATAKANA_RUN_RE,
    ARABIC_RUN_RE,
    HEBREW_RUN_RE,
    CYRILLIC_RUN_RE,
    THAI_RUN_RE,
    DEVANAGARI_RUN_RE,
  ]) {
    const r = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(text)) !== null) {
      const name = m[1].trim();
      if (!name) continue;
      const offset = m.index + (m[1].length - name.length > 0 ? m[1].indexOf(name) : 0);
      const len = name.length;
      if (isAlreadyCovered(covered, offset, len)) continue;
      if (isInsideCodeBlock(text, offset)) continue;
      hits.push({ name, offset, length: len, confidence: 0.55 });
      markCovered(covered, offset, len);
    }
  }
}

export function runAggregateStage(acc: StageAccumulator): NameMatch[] {
  acc.hits.sort((a, b) => a.offset - b.offset);
  return acc.hits;
}

function detectNamesOn(text: string, _opts?: DetectOptions): NameMatch[] {
  const acc: StageAccumulator = { hits: [], covered: [] };
  runPrefixTriggerStage(text, acc);
  runDictionaryMatchStage(text, acc);
  runCamelCaseSplitStage(text, acc);
  runNonLatinRunStage(text, acc);
  return runAggregateStage(acc);
}
