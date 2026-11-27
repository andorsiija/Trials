import { apiFetch } from '../supabase-api.js';
import { artworkImageAttrs, hydrateArtworkImages } from '../artwork-images.js';
import { logoutUser } from '../Account functions/auth-service.js';
const chips = document.querySelectorAll('.chip');
const artistGrid = document.querySelector('#artist-grid');
const search = document.querySelector('#search-input');
const empty = document.querySelector('#empty-state');
const toast = document.querySelector('#toast');
let timer;
let cards = [];
let uploadedArtists = [];
let currentNotifications = [];
let minimumPrice = null;
let maximumPrice = null;
const savedArtworkIds = new Set();

async function saveArtwork(artworkId){
	try{
		const response=await apiFetch('../supabase-data?action=save_artwork',{method:'POST',body:JSON.stringify({artworkId})});
		if(response.ok)return{ok:true};
		const data=await response.json().catch(()=>({}));
		return{ok:false,error:data.error||'Could not save artwork.'};
	}catch(error){return{ok:false,error:error.message||'Could not save artwork.'}}
}

async function unsaveArtwork(artworkId){
	try{
		const response=await apiFetch('../supabase-data?action=unsave_artwork',{method:'POST',body:JSON.stringify({artworkId})});
		if(response.ok)return{ok:true};
		const data=await response.json().catch(()=>({}));
		return{ok:false,error:data.error||'Could not remove artwork.'};
	}catch(error){return{ok:false,error:error.message||'Could not remove artwork.'}}
}

async function loadSavedArtworkIds(artworkIds){
	const ids=(artworkIds||[]).filter(Boolean);
	if(!ids.length)return;
	try{
		const session=JSON.parse(localStorage.getItem('vicom-session')||'null');
		if(!session?.userId)return;
		const response=await apiFetch('../supabase-data?action=check_saved_artworks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({artworkIds:ids})});
		if(!response.ok)return;
		const result=await response.json().catch(()=>({}));
		(result.saved||[]).forEach((id)=>savedArtworkIds.add(id));
	}catch(error){}
}

function parsePrice(value){
	const cleaned=String(value||'').replace(/[^\d.-]/g,'');
	if(!cleaned)return null;
	const parsed=Number(cleaned);
	return Number.isFinite(parsed)?parsed:null;
}

function notify(message){toast.textContent=message;toast.classList.add('show');clearTimeout(timer);timer=setTimeout(()=>toast.classList.remove('show'),2200)}

function setNotificationBadge(count){const bell=document.querySelector('#bell');if(!bell)return;const badge=bell.querySelector('.notif-badge');if(!badge)return;const total=Number(count)||0;badge.textContent=total>9?'9+':total;badge.style.display=total>0?'flex':'none'}

function renderNotifications(items){const menu=document.querySelector('#notifications-menu');if(!menu)return;const list=Array.isArray(items)?items:[];currentNotifications=list; if(!list.length){menu.innerHTML='<div class="notification-header"><h3>Notifications</h3></div><p class="notification-empty">No new notifications.</p>';return}menu.innerHTML=`<div class="notification-header"><h3>Notifications</h3><button type="button" class="notification-clear">View all</button></div><div class="notification-list">${list.map((item,index)=>`<button class="notification-item" type="button" data-index="${index}"><span class="notification-icon ${item.tone || 'green'}">${item.icon || '✓'}</span><span class="notification-copy"><strong>${item.title}</strong><small>${item.detail}</small><time>${item.time}</time></span><span class="notification-dot" aria-hidden="true"></span></button>`).join('')}</div>`;}

function toggleNotifications(forceOpen){const bell=document.querySelector('#bell');const menu=document.querySelector('#notifications-menu');if(!bell||!menu)return;const shouldOpen=typeof forceOpen==='boolean'?forceOpen:!menu.classList.contains('open');menu.classList.toggle('open',shouldOpen);bell.classList.toggle('active',shouldOpen);bell.setAttribute('aria-expanded',String(shouldOpen));}

async function loadNotifications(){const session=JSON.parse(localStorage.getItem('vicom-session')||'null');try{if(!session?.userId){renderNotifications([]);setNotificationBadge(0);return}const response=await apiFetch(`../supabase-data?action=notifications&userId=${encodeURIComponent(session.userId)}`);const result=await response.json();const list=result.notifications||[];const normalized=list.map((item,index)=>({id:item.id||null,commissionId:item.commissionId||item.commission_id||null,icon:item.kind==='commission'?'✦':item.kind==='message'?'✉':item.kind==='delivery'?'↗':'★',tone:item.kind==='commission'?'green':item.kind==='message'?'blue':item.kind==='delivery'?'gold':'green',title:item.title||'New update',detail:item.text||'There is a fresh update for you.',time:item.created_at?new Date(item.created_at).toLocaleDateString([], {month:'short', day:'numeric'}):`Now ${index+1}`}));renderNotifications(normalized);setNotificationBadge(normalized.length);}catch(error){renderNotifications([]);setNotificationBadge(0)}}

function loadLoggedInUser(){try{const session=JSON.parse(localStorage.getItem('vicom-session'));if(session?.name){document.querySelector('#user-name').textContent=`${session.name}.`;const profile=document.querySelector('#profile-initials');if(profile){if(session.profilePicture){profile.style.backgroundImage=`url('${session.profilePicture}')`;profile.style.backgroundSize='cover';profile.style.backgroundPosition='center';profile.textContent=''}else{profile.textContent=session.name.split(/\s+/).map((part)=>part[0]).join('').slice(0,2).toUpperCase()}}}}catch(error){}}

function activeSuspension(profile){
	if(!profile?.isSuspended)return null;
	if(!profile.suspensionUntil)return {hasEnd:false};
	const expiry=new Date(profile.suspensionUntil);
	if(Number.isNaN(expiry.getTime()))return {hasEnd:false};
	if(expiry.getTime()<=Date.now())return null;
	return {hasEnd:true,until:expiry};
}

function renderSuspension(profile){
	const banner=document.querySelector('#suspension-banner');
	if(!banner)return;
	const suspension=activeSuspension(profile);
	if(!suspension){banner.hidden=true;return}
	const meta=document.querySelector('#suspension-meta');
	const parts=[];
	if(profile.suspensionReason)parts.push(`Reason: ${profile.suspensionReason}`);
	parts.push(suspension.hasEnd?`Ends ${suspension.until.toLocaleString([], {dateStyle:'medium', timeStyle:'short'})}`:'This suspension has no set end date.');
	meta.textContent=parts.join(' · ');
	banner.hidden=false;
}

async function loadSuspensionStatus(){
	let session=null;
	try{session=JSON.parse(localStorage.getItem('vicom-session')||'null')}catch(error){return}
	if(!session?.userId)return;
	renderSuspension(session);
	try{
		const response=await apiFetch(`../supabase-data?action=profile&id=${encodeURIComponent(session.userId)}`);
		if(!response.ok)return;
		const result=await response.json();
		const user=result.user;
		if(!user)return;
		localStorage.setItem('vicom-session',JSON.stringify({...session,...user,isSuspended:!!user.isSuspended,suspensionUntil:user.suspensionUntil||null,suspensionReason:user.suspensionReason||''}));
		renderSuspension(user);
		loadLoggedInUser();
	}catch(error){}
}

loadLoggedInUser();
loadSuspensionStatus();

async function getUploadedArtists(){
	try{
		const response=await apiFetch('../supabase-data?action=artworks');
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
	if(value.includes('design'))return 'design';
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

function renderArtistCards(artworks){
	artistGrid.innerHTML=artworks.map((work)=>{const isSaved=savedArtworkIds.has(work.id);return `<article class="artist-card" data-style="${artistStyle(work.category)}" data-name="${work.artist.toLowerCase()}" data-price="${work.price}" data-artist-id="${work.artistId}"><div class="artist-photo"${artworkImageAttrs(work)}><a class="artist-photo-link" href="../User Side/artist.html?id=${encodeURIComponent(work.artistId)}" aria-label="View ${work.artist} profile"></a><button class="save${isSaved?' saved':''}" type="button" aria-label="${isSaved?'Unsave':'Save'} ${work.title}" data-id="${work.id}">${isSaved?'♥':'♡'}</button></div><div class="artist-info"><div><h3>${work.artist}</h3><p>${work.category} · ${work.detail||'Original artwork'}</p></div><strong>from ${work.price}</strong></div></article>`;}).join('');
	hydrateArtworkImages(artistGrid);
	cards=[...artistGrid.querySelectorAll('.artist-card')];
	artistGrid.querySelectorAll('.save').forEach((button)=>{
		const artworkId=button.dataset.id||'';
		button.addEventListener('click',async()=>{
			if(!artworkId)return;
			const session=JSON.parse(localStorage.getItem('vicom-session')||'null');
			if(!session?.userId){notify('Please log in first to save');return;}
			const wasSaved=button.classList.contains('saved');
			const result=wasSaved?await unsaveArtwork(artworkId):await saveArtwork(artworkId);
			if(!result.ok){notify(result.error);return;}
			const saved=!wasSaved;
			if(saved)savedArtworkIds.add(artworkId);else savedArtworkIds.delete(artworkId);
			button.classList.toggle('saved',saved);
			button.textContent=saved?'♥':'♡';
			notify(saved?'Artwork saved':'Artwork removed');
		});
	});
}

function renderUploadedArtists(artworks){
	uploadedArtists=artworks.map(normalizeArtwork).filter((work)=>work.artistId);
	filterArtists();
}

function filterArtists(){
	const term=search.value.trim().toLowerCase();
	const style=document.querySelector('.chip.active').dataset.style;
	const matching=uploadedArtists.filter((work)=>{
		const matchStyle=style==='all'||artistStyle(work.category)===style;
		const searchableText=[work.title,work.artist,work.category,work.detail].map((value)=>String(value||'').toLowerCase()).join(' ');
		const matchText=searchableText.includes(term);
		const price=parsePrice(work.price);
		const matchesMinimum=minimumPrice===null||(price!==null&&price>=minimumPrice);
		const matchesMaximum=maximumPrice===null||(price!==null&&price<=maximumPrice);
		return matchStyle&&matchText&&matchesMinimum&&matchesMaximum;
	});
	renderArtistCards(matching.slice(0,5));
	empty.style.display=matching.length?'none':'block';
}
chips.forEach(chip=>chip.addEventListener('click',()=>{chips.forEach(item=>item.classList.remove('active'));chip.classList.add('active');filterArtists()}));search.addEventListener('input',filterArtists);
const bell=document.querySelector('#bell');bell?.addEventListener('click',(event)=>{event.stopPropagation();toggleNotifications();});document.addEventListener('click',(event)=>{const menu=document.querySelector('#notifications-menu');const bellEl=document.querySelector('#bell');if(!menu||!bellEl)return;if(!menu.contains(event.target)&&!bellEl.contains(event.target))toggleNotifications(false);});document.querySelector('#notifications-menu')?.addEventListener('click',(event)=>{const button=event.target.closest('.notification-item');if(!button)return;const item=currentNotifications[Number(button.dataset.index)];if(!item)return;const targetId=item.commissionId||item.id;const nextUrl=targetId?`commissions.html?commissionId=${encodeURIComponent(targetId)}`:'commissions.html';window.location.href=nextUrl;});document.querySelector('#logout').addEventListener('click',async()=>{await logoutUser();localStorage.removeItem('vicom-session');window.location.href='../LandingPage/index.html'});
const filterButton=document.querySelector('#filter-button');
const priceFilterPanel=document.querySelector('#price-filter-panel');
const minPriceInput=document.querySelector('#min-price');
const maxPriceInput=document.querySelector('#max-price');
const clearPriceFilter=document.querySelector('#clear-price-filter');

filterButton?.addEventListener('click',()=>{
	const isOpen=!priceFilterPanel.hidden;
	priceFilterPanel.hidden=isOpen;
	filterButton.setAttribute('aria-expanded',String(!isOpen));
});

function updatePriceFilter(){
	minimumPrice=minPriceInput.value===''?null:Number(minPriceInput.value);
	maximumPrice=maxPriceInput.value===''?null:Number(maxPriceInput.value);
	filterArtists();
}

minPriceInput?.addEventListener('input',updatePriceFilter);
maxPriceInput?.addEventListener('input',updatePriceFilter);
clearPriceFilter?.addEventListener('click',()=>{
	minPriceInput.value='';
	maxPriceInput.value='';
	minimumPrice=null;
	maximumPrice=null;
	filterArtists();
});
const modal=document.querySelector('#brief-modal');document.querySelector('#brief-button').addEventListener('click',()=>{modal.classList.add('open');modal.setAttribute('aria-hidden','false')});document.querySelector('#close-modal').addEventListener('click',()=>{modal.classList.remove('open');modal.setAttribute('aria-hidden','true')});document.querySelector('#submit-brief').addEventListener('click',()=>{modal.classList.remove('open');notify('Your brief has been saved')});

// Help/Support Button
const helpButton = document.querySelector('#help-button');
const helpMenu = document.querySelector('#help-menu');
const helpClose = document.querySelector('#help-close');

helpButton?.addEventListener('click', () => {
  helpMenu.hidden = !helpMenu.hidden;
});

helpClose?.addEventListener('click', () => {
  helpMenu.hidden = true;
});

// Close help menu when clicking outside
document.addEventListener('click', (e) => {
  if (!helpMenu.contains(e.target) && !helpButton.contains(e.target)) {
    helpMenu.hidden = true;
  }
});

// Close help menu on escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !helpMenu.hidden) {
    helpMenu.hidden = true;
  }
});

loadNotifications();
getUploadedArtists().then(async(artworks)=>{
	await loadSavedArtworkIds((artworks||[]).map((work)=>work.id).filter(Boolean));
	renderUploadedArtists(artworks);
});

const todaysDate = document.querySelector('#todays-date');
if (todaysDate) {
  todaysDate.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: '2-digit'
  });
}
