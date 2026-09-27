import { apiFetch } from '../firebase-api.js';
import { logoutUser } from '../Account functions/auth-service.js';
const chips = document.querySelectorAll('.chip');
const artistGrid = document.querySelector('#artist-grid');
const search = document.querySelector('#search-input');
const empty = document.querySelector('#empty-state');
const toast = document.querySelector('#toast');
const filterButton = document.querySelector('#filter-button');
const priceFilterPanel = document.querySelector('#price-filter-panel');
const minPriceInput = document.querySelector('#min-price');
const maxPriceInput = document.querySelector('#max-price');
const clearPriceFilter = document.querySelector('#clear-price-filter');
let timer;
let cards = [];
let uploadedArtists = [];
let minimumPrice = null;
let maximumPrice = null;
let artistRateMapPromise;
const artistRateMap = new Map();

function notify(message){toast.textContent=message;toast.classList.add('show');clearTimeout(timer);timer=setTimeout(()=>toast.classList.remove('show'),2200)}

function loadLoggedInUser(){try{const session=JSON.parse(localStorage.getItem('vicom-session'));if(session?.name){document.querySelector('#user-name').textContent=`${session.name}.`;document.querySelector('#profile-initials').textContent=session.name.split(/\s+/).map((part)=>part[0]).join('').slice(0,2).toUpperCase()}}catch(error){}}

async function getUploadedArtists(){
	try{
		const response=await apiFetch('../firebase-data?action=artworks');
		if(!response.ok)throw new Error('Artwork API unavailable');
		const result=await response.json();
		if(Array.isArray(result.artworks)&&result.artworks.length)return result.artworks;
		throw new Error('No database artwork found');
	}catch(error){return []}
}

function artistStyle(category){
	const value=String(category||'').toLowerCase();
	if(value.includes('portrait'))return 'portrait';
	if(value.includes('illustration'))return 'illustration';
	if(value.includes('tattoo'))return 'tattoo';
	if(value.includes('painting'))return 'painting';
	return 'brand';
}

function normalizeArtwork(work){
	return {
		...work,
		artistId:work.artistId||work.artist_id||'',
		artist:work.artist||work.artistName||'Unknown artist',
		category:work.category||'Original artwork'
	};
}

async function loadArtistRateMap(){
	if(artistRateMapPromise)return artistRateMapPromise;
	const artistIds=[...new Set(uploadedArtists.map((work)=>work.artistId).filter(Boolean).map(String))];
	artistRateMapPromise=Promise.all(artistIds.map(async(artistId)=>{
		try{
			const response=await apiFetch(`../firebase-data?action=artist&id=${encodeURIComponent(artistId)}&countView=false`);
			if(!response.ok)throw new Error('Artist rates unavailable');
			const profile=await response.json();
			const prices=(profile.rates||[]).map((rate)=>Number(rate.price)).filter((price)=>Number.isFinite(price)&&price>0);
			artistRateMap.set(artistId,prices.length?Math.min(...prices):null);
		}catch(error){artistRateMap.set(artistId,null)}
	}));
	return artistRateMapPromise;
}

function renderUploadedArtists(artworks){
	uploadedArtists=artworks.map(normalizeArtwork).filter((work)=>work.artistId).slice(0,3);
	artistGrid.innerHTML=uploadedArtists.map((work)=>`<article class="artist-card" data-style="${artistStyle(work.category)}" data-name="${work.artist.toLowerCase()}" data-artist-id="${work.artistId}"><div class="artist-photo" style="background-image:url('${work.image}')"><a class="artist-photo-link" href="../User Side/artist.html?id=${encodeURIComponent(work.artistId)}" aria-label="View ${work.artist} profile"></a><button class="save" aria-label="Save ${work.artist}">♡</button></div><div class="artist-info"><div><h3>${work.artist}</h3><p>${work.category} · ${work.detail||'Original artwork'}</p></div></div></article>`).join('');
	cards=[...artistGrid.querySelectorAll('.artist-card')];
	artistGrid.querySelectorAll('.save').forEach((button)=>button.addEventListener('click',()=>{button.classList.toggle('saved');button.textContent=button.classList.contains('saved')?'♥':'♡';notify(button.classList.contains('saved')?'Artist saved':'Artist removed')}));
	filterArtists();
}

loadLoggedInUser();
async function filterArtists(){
	if(minimumPrice!==null||maximumPrice!==null)await loadArtistRateMap();
	const term=search.value.trim().toLowerCase();
	const style=document.querySelector('.chip.active').dataset.style;
	let count=0;
	cards.forEach((card)=>{
		const rate=artistRateMap.get(card.dataset.artistId);
		const matchStyle=style==='all'||card.dataset.style===style;
		const matchText=card.dataset.name.includes(term);
		const matchBudget=(minimumPrice===null&&maximumPrice===null)||(rate!==null&&rate!==undefined&&(minimumPrice===null||rate>=minimumPrice)&&(maximumPrice===null||rate<=maximumPrice));
		const show=matchStyle&&matchText&&matchBudget;
		card.classList.toggle('hidden',!show);
		if(show)count++;
	});
	empty.style.display=count?'none':'block';
}
chips.forEach(chip=>chip.addEventListener('click',()=>{chips.forEach(item=>item.classList.remove('active'));chip.classList.add('active');filterArtists()}));search.addEventListener('input',filterArtists);
document.querySelector('#bell').addEventListener('click',()=>notify('You are all caught up'));
document.querySelector('#logout').addEventListener('click',async()=>{await logoutUser();localStorage.removeItem('vicom-session');window.location.href='../LandingPage/index.html'});
filterButton.addEventListener('click',()=>{const isOpen=!priceFilterPanel.hidden;priceFilterPanel.hidden=isOpen;filterButton.setAttribute('aria-expanded',String(!isOpen))});
function updatePriceFilter(){minimumPrice=minPriceInput.value===''?null:Number(minPriceInput.value);maximumPrice=maxPriceInput.value===''?null:Number(maxPriceInput.value);filterArtists()}
minPriceInput.addEventListener('input',updatePriceFilter);maxPriceInput.addEventListener('input',updatePriceFilter);
clearPriceFilter.addEventListener('click',()=>{minPriceInput.value='';maxPriceInput.value='';minimumPrice=null;maximumPrice=null;filterArtists()});
const modal=document.querySelector('#brief-modal');document.querySelector('#brief-button').addEventListener('click',()=>{modal.classList.add('open');modal.setAttribute('aria-hidden','false')});document.querySelector('#close-modal').addEventListener('click',()=>{modal.classList.remove('open');modal.setAttribute('aria-hidden','true')});document.querySelector('#submit-brief').addEventListener('click',()=>{modal.classList.remove('open');notify('Your brief has been saved')});
getUploadedArtists().then(renderUploadedArtists);
