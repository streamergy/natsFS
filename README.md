# NATSfs

This project allows you to synchronize an object store from NATS into your filesystem.
It listens for changes in NATS, any updates local files live.

## Usage

```
usage: sync.js [-h] [-u HOST] [-t TOKEN] -b BUCKET -m MOUNT [-c CONFIG]

Sync objects from a NATS object store to your filesystem

optional arguments:
  -h, --help            show this help message and exit
  -u HOST, --host HOST  NATS broker host. Default "localhost:4222"
  -t TOKEN, --token TOKEN
                        NATS broker token
  -b BUCKET, --bucket BUCKET
                        NATS object bucket name
  -m MOUNT, --mount MOUNT
                        Folder to sync objects to
  -c CONFIG, --config CONFIG
                        Path to config file. CLI options override options from the file
```

Example invocation:
```
node ./sync.js \
    --host localhost:42223 \
    --token 1234567890 \
    -b fs \
    -m mnt/
```
Where `fs` is the name of the bucket in NATS and `mnt/` is a local folder where all files will be written to.

Also, with the provided `config.json`, you can invoke the sync like this
```
node ./sync.js --config config.json
```
Options from the CLI will override options given in the config file.