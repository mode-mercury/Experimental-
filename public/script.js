const tabSimple = document.getElementById('tabSimple');
const tabAdvanced = document.getElementById('tabAdvanced');
const simpleModeEl = document.getElementById('simpleMode');
const advancedModeEl = document.getElementById('advancedMode');

const promptEl = document.getElementById('prompt');
const promptGenerateBtn = document.getElementById('promptGenerate');
const playSimpleBtn = document.getElementById('playSimple');
const pauseSimpleBtn = document.getElementById('pauseSimple');
const resumeSimpleBtn = document.getElementById('resumeSimple');
const stopSimpleBtn = document.getElementById('stopSimple');

const statusEl = document.getElementById('status');
const generateBtn = document.getElementById('generate');
const uploadEl = document.getElementById('midiUpload');
const playBtn = document.getElementById('play');
const stopBtn = document.getElementById('stop');
const pauseBtn = document.getElementById('pause');
const resumeBtn = document.getElementById('resume');
const likeBtn = document.getElementById('like');
const dislikeBtn = document.getElementById('dislike');
const sequencerEl = document.getElementById('sequencer');
const mixerEl = document.getElementById('mixer');

let generatedPart;
let synth;
let currentSeq;

// --- Retro Step Sequencer Setup ---
const steps = 16;
const trackDefs = [
  {name: 'Kick', create: () => new Tone.MembraneSynth({pitchDecay:0.05})},
  {name: 'Snare', create: () => new Tone.NoiseSynth({envelope:{attack:0.001,decay:0.2,sustain:0}})},
  {name: 'HiHat', create: () => new Tone.NoiseSynth({envelope:{attack:0.001,decay:0.05,sustain:0}})},
  {name: 'OpenHat', create: () => new Tone.NoiseSynth({envelope:{attack:0.001,decay:0.3,sustain:0}})},
  {name: 'Tom', create: () => new Tone.MembraneSynth({octaves:2})},
  {name: 'Cymbal', create: () => new Tone.MetalSynth()},
  {name: 'FMSynth', create: () => new Tone.FMSynth()},
  {name: 'Granular', create: () => new Tone.GrainPlayer('https://tonejs.github.io/audio/berklee/gong_1.mp3')},
  {name: 'Additive', create: () => new Tone.PolySynth(Tone.Synth)}
];

const tracks = trackDefs.map(t => {
  const chain = createChannel();
  const inst = t.create();
  inst.connect(chain.input);
  return {name: t.name, synth: inst, channel: chain.channel};
});

function createChannel(){
  const channel = new Tone.Channel({pan:0, volume:0});
  const distortion = new Tone.Distortion(0.1);
  const delay = new Tone.FeedbackDelay('8n', 0.25);
  const chorus = new Tone.Chorus(4, 2.5, 0.3).start();
  const tremolo = new Tone.Tremolo(8, 0.5).start();
  const filter = new Tone.Filter(1200, 'lowpass');
  const compressor = new Tone.Compressor(-10, 3);
  distortion.chain(delay, chorus, tremolo, filter, compressor, channel, Tone.Destination);
  return {input: distortion, channel};
}

function createSequencerUI(){
  const table = document.createElement('table');
  let head = '<tr><th></th>';
  for(let s=1;s<=steps;s++) head += `<th>${s}</th>`;
  head += '</tr>';
  table.innerHTML = head;
  tracks.forEach((trk,i)=>{
    const row = document.createElement('tr');
    row.dataset.track=i;
    let cells = `<td>${trk.name}</td>`;
    for(let s=0;s<steps;s++){
      const id = `t${i}s${s}`;
      cells += `<td><input type="checkbox" id="${id}"><label for="${id}"></label></td>`;
    }
    row.innerHTML = cells;
    table.appendChild(row);
  });
  sequencerEl.appendChild(table);
}

function createMixerUI(){
  tracks.slice(0,12).forEach((trk,i)=>{
    const div = document.createElement('div');
    div.className = 'channel';
    div.innerHTML = `<div>${trk.name}</div><input type="range" min="-60" max="0" value="0" step="1" class="fader" />`;
    const fader = div.querySelector('.fader');
    fader.oninput = e => trk.channel.volume.value = e.target.value;
    mixerEl.appendChild(div);
  });
}

function showSimple(){
  simpleModeEl.classList.remove('hidden');
  advancedModeEl.classList.add('hidden');
  tabSimple.classList.add('active');
  tabAdvanced.classList.remove('active');
}

function showAdvanced(){
  advancedModeEl.classList.remove('hidden');
  simpleModeEl.classList.add('hidden');
  tabAdvanced.classList.add('active');
  tabSimple.classList.remove('active');
  if(!sequencerEl.hasChildNodes()){
    createSequencerUI();
    createMixerUI();
  }
}


let currentStep = 0;
Tone.Transport.scheduleRepeat(time=>{
  tracks.forEach((trk,i)=>{
    const box = document.getElementById(`t${i}s${currentStep}`);
    if(box && box.checked){
      if(trk.synth.triggerAttackRelease){
        trk.synth.triggerAttackRelease('C3','16n',time);
      } else if(trk.synth.start){
        trk.synth.start(time);
      }
    }
  });
  currentStep = (currentStep + 1) % steps;
}, '16n');

const model = new mm.MusicRNN('https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/melody_rnn');
model.initialize();

function log(msg) {
  statusEl.textContent += "\n" + msg;
  statusEl.scrollTop = statusEl.scrollHeight;
}

const LIKED_KEY = 'likedSequences';

function loadLikedSequences() {
  const data = localStorage.getItem(LIKED_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveLikedSequence(seq) {
  const liked = loadLikedSequences();
  liked.push(seq);
  localStorage.setItem(LIKED_KEY, JSON.stringify(liked));
}

async function getSequence(file) {
  log('Loading MIDI...');
  const reader = new FileReader();
  return new Promise(resolve => {
    reader.onload = () => {
      const midi = new Midi(reader.result);
      const ns = mm.midiToSequenceProto(midi);
      resolve(ns);
    };
    reader.readAsArrayBuffer(file);
  });
}

async function generateSequence(ns) {
  log('Generating...');
  const quantized = mm.sequences.quantizeNoteSequence(ns, 1);
  const rnnSeq = await model.continueSequence(quantized, 128, 1.2);
  const unquantized = mm.sequences.unquantizeSequence(rnnSeq);
  return unquantized;
}

function sequenceToPart(ns) {
  const {Part} = Tone;
  const part = new Part();
  ns.notes.forEach(note => {
    part.add(note.startTime, {
      midi: note.pitch,
      duration: note.endTime - note.startTime,
      velocity: note.velocity / 127
    });
  });
  part.loop = false;
  return part;
}

async function generateFromPrompt(prompt) {
  log('Requesting AI generation...');
  try {
    const resp = await fetch('https://api.example.com/musicgen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    const buf = await resp.arrayBuffer();
    const midi = new Midi(buf);
    return mm.midiToSequenceProto(midi);
  } catch (e) {
    log('Remote generation failed, using local RNN.');
    const primer = mm.sequences.quantizeNoteSequence(mm.sequences.createNoteSequence(), 1);
    return generateSequence(primer);
  }
}

generateBtn.onclick = async () => {
  const file = uploadEl.files[0];
  let primer = null;
  if (file) {
    primer = await getSequence(file);
  }
  const liked = loadLikedSequences();
  if (!primer && liked.length > 0) {
    primer = liked[Math.floor(Math.random() * liked.length)];
    log('Using liked sequence as primer.');
  }
  if (!primer) {
    log('Please upload a MIDI file or like a generated track first.');
    return;
  }

  const genSeq = await generateSequence(primer);
  currentSeq = genSeq;

  synth = new Tone.PolySynth(Tone.Synth).toDestination();
  generatedPart = sequenceToPart(genSeq);
  generatedPart.callback = time => {
    const event = generatedPart.events.shift();
    synth.triggerAttackRelease(Tone.Midi(event.value.midi).toFrequency(), event.value.duration, time, event.value.velocity);
    generatedPart.events.push(event);
  };
  log('Ready to play.');
};

playBtn.onclick = () => {
  if (generatedPart) {
    Tone.Transport.start();
    generatedPart.start(0);
    log('Playing...');
  }
};

stopBtn.onclick = () => {
  Tone.Transport.stop();
  Tone.Transport.cancel();
  log('Stopped.');
};

pauseBtn.onclick = () => {
  Tone.Transport.pause();
  log('Paused.');
};

resumeBtn.onclick = () => {
  Tone.Transport.start();
  log('Resumed.');
};

likeBtn.onclick = () => {
  if (currentSeq) {
    saveLikedSequence(currentSeq);
    log('Track saved to liked sequences.');
  }
};

dislikeBtn.onclick = () => {
  log('Track discarded.');
};

promptGenerateBtn.onclick = async () => {
  const prompt = promptEl.value.trim();
  if(!prompt){
    log('Please enter a prompt.');
    return;
  }
  const seq = await generateFromPrompt(prompt);
  currentSeq = seq;
  synth = new Tone.PolySynth(Tone.Synth).toDestination();
  generatedPart = sequenceToPart(seq);
  generatedPart.callback = time => {
    const event = generatedPart.events.shift();
    synth.triggerAttackRelease(Tone.Midi(event.value.midi).toFrequency(), event.value.duration, time, event.value.velocity);
    generatedPart.events.push(event);
  };
  log('Ready to play.');
};

tabSimple.onclick = showSimple;
tabAdvanced.onclick = showAdvanced;

playSimpleBtn.onclick = playBtn.onclick;
pauseSimpleBtn.onclick = pauseBtn.onclick;
resumeSimpleBtn.onclick = resumeBtn.onclick;
stopSimpleBtn.onclick = stopBtn.onclick;

showSimple();
