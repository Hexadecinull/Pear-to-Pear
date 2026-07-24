import { mount } from 'svelte';
import App from './App.svelte';
import './styles/app.css';

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app root element');

const app = mount(App, { target });

export default app;
