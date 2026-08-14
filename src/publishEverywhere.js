const { publishMultiPhotoPost } = require('./facebook');

// Posts to the Page (required) and, if group credentials are configured,
// also posts the same content to the Facebook Group. Group posting needs a
// USER access token with `publish_to_groups` (not the Page token), since
// Pages and Groups are authorized separately on Meta's side. A group
// failure is logged but never fails the whole run - the Page post already
// succeeded and is the primary deliverable.
async function publishEverywhere({ imagePaths, message }) {
  const pagePost = await publishMultiPhotoPost({
    pageId: process.env.FB_PAGE_ID,
    accessToken: process.env.FB_PAGE_ACCESS_TOKEN,
    imagePaths,
    message,
  });
  console.log('Đăng bài lên Fanpage thành công:', pagePost);

  if (process.env.FB_GROUP_ID && process.env.FB_GROUP_ACCESS_TOKEN) {
    try {
      const groupPost = await publishMultiPhotoPost({
        pageId: process.env.FB_GROUP_ID,
        accessToken: process.env.FB_GROUP_ACCESS_TOKEN,
        imagePaths,
        message,
      });
      console.log('Đăng bài lên Group thành công:', groupPost);
    } catch (err) {
      console.error('Đăng bài lên Group thất bại (bỏ qua, bài Fanpage vẫn đã đăng):', err.message);
    }
  } else {
    console.log('Bỏ qua đăng lên Group (thiếu FB_GROUP_ID / FB_GROUP_ACCESS_TOKEN).');
  }

  return pagePost;
}

module.exports = { publishEverywhere };
