import { getAuthorizeUrl } from './_shared.js'

export default async function handler(req, res) {
  res.redirect(getAuthorizeUrl(req, res))
}
