source_f="$1"
[ -f "$source_f" ] || { echo "Pass in source file as first argument"; exit 1; }
source_f=$(realpath "$source_f")

[ -d ./from-roam ] && rm -rf ./from-roam
mkdir ./from-roam
cd ./from-roam

cp "$source_f" ./input.zip
unzip input.zip
rm input.zip

[ -d ./roam ] && rm -rf ./roam

# Fix Roam notes with '/' in them turning into directories
while [ -n "$(find . -mindepth 1 -maxdepth 1 -type d)" ]; do
  find . -mindepth 1 -maxdepth 1 -type d -exec echo '{}' \; | while read dir; do
    find "$dir" -mindepth 1 -maxdepth 1 -exec basename '{}' \; | while read sub; do
      echo "$dir/$sub"
      mv "$dir/$sub" ./"$dir-$sub"
    done
    rm -rf "$dir"
  done
done

# Rename notes and head notes with [:name:]
find . -type f -exec basename '{}' \; | while read fname; do
  echo "$fname"
  new_name=$(cat /dev/random | tr -dc 0-9 | head -c20)r
  title="${fname:0:-3}"  # strip .md
  { echo "[:${title}:]"; echo; cat "$fname"; } > ./"$new_name".z
  rm "$fname"
done
