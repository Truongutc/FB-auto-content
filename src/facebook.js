const fs = require('fs');
const path = require('path');

const GRAPH_VERSION = 'v21.0';

async function publishPhotoPost({ pageId, accessToken, imagePath, message }) {
  const buffer = fs.readFileSync(imagePath);
  const form = new FormData();
  form.append('message', message);
  form.append('access_token', accessToken);
  form.append('source', new Blob([buffer]), path.basename(imagePath));

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`, {
    method: 'POST',
    body: form,
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Facebook API lỗi: ${JSON.stringify(data.error || data)}`);
  }
  return data; // { id, post_id }
}

async function uploadUnpublishedPhoto({ pageId, accessToken, imagePath }) {
  const buffer = fs.readFileSync(imagePath);
  const form = new FormData();
  form.append('published', 'false');
  form.append('access_token', accessToken);
  form.append('source', new Blob([buffer]), path.basename(imagePath));

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`, {
    method: 'POST',
    body: form,
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Facebook API lỗi (upload photo): ${JSON.stringify(data.error || data)}`);
  }
  return data.id;
}

async function publishMultiPhotoPost({ pageId, accessToken, imagePaths, message }) {
  const photoIds = [];
  for (const imagePath of imagePaths) {
    const id = await uploadUnpublishedPhoto({ pageId, accessToken, imagePath });
    photoIds.push(id);
  }

  const form = new FormData();
  form.append('message', message);
  form.append('access_token', accessToken);
  photoIds.forEach((id, i) => {
    form.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: id }));
  });

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/feed`, {
    method: 'POST',
    body: form,
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Facebook API lỗi (feed post): ${JSON.stringify(data.error || data)}`);
  }
  return data; // { id: post_id }
}

module.exports = { publishPhotoPost, publishMultiPhotoPost };
