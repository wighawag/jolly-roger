import {writable} from 'svelte/store';

const darkMode = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

const darkModeStore = writable(darkMode);
if (typeof localStorage !== 'undefined') {
  darkModeStore.subscribe((value) => {
    localStorage.setItem('theme', value ? 'dark' : 'light');
    if (value) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  });
}
export default darkModeStore;
