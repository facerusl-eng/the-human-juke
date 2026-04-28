import { getAuthorizeUrl } from './_shared.js'

export default async function handler(_req, res) {
  res.redirect(getAuthorizeUrl())
}
