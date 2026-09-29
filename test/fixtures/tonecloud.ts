/**
 * A real ToneCloud preset ("Blues Legend", public), fetched 2026-09-28 from
 * GET https://api.positivegrid.com/v2/preset/6abaa161e9519e95946c709b. Creator profile, comments and
 * likes removed (other people's data). SOURCED: ToneCloud.
 */
export const TONECLOUD_PRESET = {
  "_id": "6abaa161e9519e95946c709b",
  "id": "6abaa161e9519e95946c709b",
  "name": "Blues Legend",
  "description": "",
  "category": "Pop",
  "preset_for": "spark",
  "preset_data": "{\"type\":\"jamup_speaker\",\"meta\":{\"id\":\"8cc25173-1c0e-4fe4-adec-de6d86b2cafe\",\"description\":\"\",\"name\":\"Blues Legend\",\"version\":\"0.7\",\"icon\":\"icon.png\"},\"bpm\":120,\"sigpath\":[{\"type\":\"speaker_fx\",\"dspId\":\"bias.noisegate\",\"active\":true,\"params\":[{\"index\":0,\"value\":0.075520836},{\"index\":1,\"value\":0.08160717},{\"index\":2,\"value\":1}]},{\"type\":\"speaker_fx\",\"dspId\":\"Compressor\",\"active\":false,\"params\":[{\"index\":0,\"value\":0.43502474},{\"index\":1,\"value\":0.6475722}]},{\"type\":\"speaker_fx\",\"dspId\":\"Booster\",\"active\":true,\"params\":[{\"index\":0,\"value\":0.6857}]},{\"type\":\"speaker_fx\",\"dspId\":\"Bassman\",\"active\":true,\"params\":[{\"index\":0,\"value\":0.4003837},{\"index\":1,\"value\":0.6630777},{\"index\":2,\"value\":0.4724149},{\"index\":3,\"value\":0.35933122},{\"index\":4,\"value\":0.8179}]},{\"type\":\"speaker_fx\",\"dspId\":\"Phaser\",\"active\":false,\"params\":[{\"index\":0,\"value\":0.33645833},{\"index\":1,\"value\":0.6095834},{\"index\":2,\"value\":0},{\"index\":3,\"value\":0}]},{\"type\":\"speaker_fx\",\"dspId\":\"DelayRe201\",\"active\":false,\"params\":[{\"index\":0,\"value\":0.26535866},{\"index\":1,\"value\":0.37925664},{\"index\":2,\"value\":0.294517},{\"index\":3,\"value\":0.599541},{\"index\":4,\"value\":1}]},{\"type\":\"speaker_fx\",\"dspId\":\"bias.reverb\",\"active\":true,\"params\":[{\"index\":0,\"value\":0.8},{\"index\":1,\"value\":0.18045193},{\"index\":2,\"value\":0.57857144},{\"index\":3,\"value\":0.6785714},{\"index\":4,\"value\":0.62490624},{\"index\":5,\"value\":0.35714287},{\"index\":6,\"value\":0.5}]}],\"loudness\":-25.64625453997999,\"extraGain\":0.5}",
  "preset_meta": {
    "dspId": [
      "bias.noisegate",
      "Compressor",
      "Booster",
      "Bassman",
      "Phaser",
      "DelayRe201",
      "bias.reverb"
    ]
  },
  "num_downloads": 0,
  "num_likes": 0,
  "rating_avg": 0,
  "signal_chain_type": "in1",
  "updated_on": "2026-09-28 17:18:25"
} as const;
