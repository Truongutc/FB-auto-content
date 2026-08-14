const { publishMultiPhotoPost } = require('./facebook');

// Posts to the Page (required) and, if a Group ID is configured, also posts
// the same content there. The Group is linked to/owned by the Page, so the
// existing Page token is tried first (FB_GROUP_ACCESS_TOKEN only needs to be
// set if that doesn't work and a USER token with publish_to_groups turns out
// to be required instead). A group failure is logged but never fails the
// whole run - the Page post already succeeded and is the primary deliverable.
async function publishEverywhere({ imagePaths, message }) {
  const pagePost = await publishMultiPhotoPost({
    pageId: process.env.FB_PAGE_ID,
    accessToken: process.env.FB_PAGE_ACCESS_TOKEN,
    imagePaths,
    message,
  });
  console.log('Đăng bài lên Fanpage thành công:', pagePost);

  if (process.env.FB_GROUP_ID) {
    try {
      const groupPost = await publishMultiPhotoPost({
        pageId: process.env.FB_GROUP_ID,
        accessToken: process.env.FB_GROUP_ACCESS_TOKEN || process.env.FB_PAGE_ACCESS_TOKEN,
        imagePaths,
        message,
      });
      console.log('Đăng bài lên Group thành công:', groupPost);
    } catch (err) {
      console.error('Đăng bài lên Group thất bại (bỏ qua, bài Fanpage vẫn đã đăng):', err.message);
    }
  } else {
    console.log('Bỏ qua đăng lên Group (thiếu FB_GROUP_ID).');
  }

  return pagePost;
}

module.exports = { publishEverywhere };
