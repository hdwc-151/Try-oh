import { Router } from 'express'
import sharp from 'sharp'
import { createImageUpload, validateImageContent } from '../http/image-upload.js'
import type { ImageStorage } from '../storage/image-storage.js'
import type { SocialService } from './social-service.js'
import { discardImages, ImmediateStorageCleanup, type StorageCleanup } from '../storage/storage-cleanup.js'

const avatarUpload = createImageUpload(1).single('avatar')
const postUpload = createImageUpload(3).array('images', 3)
const imageKeyFromUrl = (value: string) => {
  if (!value.startsWith('/uploads/')) return null
  try { return decodeURIComponent(value.slice('/uploads/'.length)) } catch { return null }
}

export function createSocialRouter(
  store: SocialService,
  images: ImageStorage,
  cleanup: StorageCleanup = new ImmediateStorageCleanup(images),
) {
  const router = Router()
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next() })
  router.get('/', async (req,res,next) => { try { res.json(await store.snapshot(req.authUser.id)) } catch (error) { next(error) } })
  router.get('/search', async (req,res,next) => { try { res.json(await store.search(req.authUser.id, String(req.query.q ?? ''))) } catch (error) { next(error) } })
  router.get('/invite', async (req,res,next) => { try { res.json(await store.resolveInvite(req.authUser.id, String(req.query.code ?? ''))) } catch (error) { next(error) } })
  router.get('/profile/:id', async (req,res,next) => { try { res.json(await store.profile(req.authUser.id, String(req.params.id))) } catch (error) { next(error) } })
  // Moderation lives under /api/admin/moderation (admin router), where every action is audited.
  router.post('/avatar', avatarUpload, async (req,res,next) => {
    let savedKey: string | null = null
    try {
      if (!req.file) {
        res.status(400).json({ message: 'Hãy chọn một ảnh đại diện.' })
        return
      }
      await validateImageContent(req.file)
      const before = await store.snapshot(req.authUser.id)
      const avatar = await sharp(req.file.buffer)
        .rotate()
        .resize(512, 512, { fit: 'cover', position: 'attention' })
        .webp({ quality: 84 })
        .toBuffer()
      savedKey = await images.save(avatar, 'image/webp')
      const updated = await store.act(req.authUser.id, 'settings', {
        username: before.me.username,
        avatar: images.publicUrl(savedKey),
        invitePolicy: before.me.invitePolicy,
        defaultVisibility: before.me.defaultVisibility,
      })
      const oldKey = imageKeyFromUrl(before.me.avatar)
      if (oldKey && oldKey !== savedKey) await discardImages(cleanup, [oldKey], 'avatar_replaced')
      savedKey = null
      res.json(updated)
    } catch (error) {
      await discardImages(cleanup, [savedKey], 'avatar_upload_failed')
      next(error)
    }
  })
  router.delete('/avatar', async (req,res,next) => {
    try {
      const before = await store.snapshot(req.authUser.id)
      if (!before.me.avatar) {
        res.json(before)
        return
      }
      const updated = await store.act(req.authUser.id, 'settings', {
        username: before.me.username,
        avatar: '',
        invitePolicy: before.me.invitePolicy,
        defaultVisibility: before.me.defaultVisibility,
      })
      const oldKey = imageKeyFromUrl(before.me.avatar)
      await discardImages(cleanup, [oldKey], 'avatar_removed')
      res.json(updated)
    } catch (error) {
      next(error)
    }
  })
  router.post('/publish', postUpload, async (req,res,next) => {
    const savedKeys: string[] = []
    try {
      const files = Array.isArray(req.files) ? req.files : []
      const kind = req.body?.kind === 'poll' ? 'poll' : 'post'
      if (!files.length || files.length > 3 || (kind === 'poll' && files.length < 2)) {
        res.status(400).json({ message: kind === 'poll' ? 'Chọn 2–3 ảnh để tạo bình chọn.' : 'Chọn 1–3 ảnh để đăng.' })
        return
      }
      const imageUrls: string[] = []
      for (const file of files) {
        await validateImageContent(file)
        const optimized = await sharp(file.buffer).rotate().resize(1600, 1600, { fit:'inside', withoutEnlargement:true }).webp({ quality:86 }).toBuffer()
        const key = await images.save(optimized, 'image/webp')
        savedKeys.push(key)
        imageUrls.push(images.publicUrl(key))
      }
      const parseIds = (value: unknown) => {
        if (Array.isArray(value)) return value
        if (typeof value !== 'string' || !value) return []
        try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
      }
      const updated = await store.act(req.authUser.id, kind === 'poll' ? 'image-poll-create' : 'post-create', {
        imageUrls,
        caption:req.body?.caption ?? '',
        title:req.body?.title ?? '',
        hours:Number(req.body?.hours ?? 24),
        visibility:req.body?.visibility ?? 'friends',
        groupIds:parseIds(req.body?.groupIds),
        recipientIds:parseIds(req.body?.recipientIds),
      })
      savedKeys.length = 0
      res.json(updated)
    } catch (error) {
      await discardImages(cleanup, savedKeys, 'post_upload_failed')
      next(error)
    }
  })
  router.post('/post-delete', async (req,res,next) => {
    try {
      const before = await store.snapshot(req.authUser.id)
      const post = before.posts.find(item => item.id === req.body?.id && item.owner.id === req.authUser.id)
        ?? before.creatorFeed.find(item => item.id === req.body?.id && item.owner.id === req.authUser.id)
      const updated = await store.act(req.authUser.id, 'post-delete', req.body ?? {})
      await discardImages(cleanup, (post?.imageUrls ?? []).map(imageKeyFromUrl), 'post_deleted')
      res.json(updated)
    } catch (error) { next(error) }
  })
  router.post('/:action', async (req,res,next) => {
    try {
      const action = String(req.params.action)
      if (action === 'post-create' || action === 'image-poll-create') {
        res.status(404).json({ message:'Thao tác không khả dụng.' })
        return
      }
      res.json(await store.act(req.authUser.id, action, req.body ?? {}))
    } catch (error) { next(error) }
  })
  return router
}
