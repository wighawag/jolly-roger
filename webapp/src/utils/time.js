export function deltaTime(setTime) {
  let now = new Date();
  let delta = (setTime * 1000 - now) / 1000; // to seconds
  let time;
  if (delta > 0) {
    let days = Math.floor(delta / 60 / 60 / 24);
    let hours = Math.floor(delta / 60 / 60) % 24;
    let minutes = Math.floor(delta / 60) % 60;
    let seconds = parseInt(delta % 60);
    let words = { single: [" day ", " hr ", " min ", " sec "], plural: [" days ", " hrs ", " mins ", " secs "] };
    time =
      days.toString() +
      (days == 1 ? words.single[0] : words.plural[0]) +
      hours.toString() +
      (hours == 1 ? words.single[1] : words.plural[1]) +
      minutes +
      (minutes == 1 ? words.single[2] : words.plural[2]) +
      seconds +
      (seconds == 1 ? words.single[3] : words.plural[3]);
    return time;
  }
  return "Revealed";
}
