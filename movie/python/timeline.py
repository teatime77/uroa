import os
import glob
import json
import datetime
from make_audio import lang_list
from mutagen.mp3 import MP3
import subprocess
from pydub import AudioSegment

i18n_dir = '../../firebase.ts/public/lib/i18n'
lang_codes = [x[0] for x in lang_list]

current_dir = os.getcwd()

def format_seconds(seconds):
    # Get the whole number of seconds and milliseconds separately
    milliseconds = int((seconds % 1) * 1000)
    whole_seconds = int(seconds)
    
    # Use divmod to get hours, minutes, and seconds
    hours, remainder = divmod(whole_seconds, 3600)
    minutes, sec = divmod(remainder, 60)
    
    # Format the time as hh:mm:ss.999
    formatted_time = f"{hours:02}:{minutes:02}:{sec:02},{milliseconds:03}"
    return formatted_time


def make_durations():
    durations = {}

    for code3 in lang_codes:
        target_dir = f'../../firebase.ts/public/lib/i18n/audio/{code3}'

        os.chdir(target_dir)
        for file in glob.glob("*.mp3"):
            (name, _) = file.split(".")
            num = int(name.strip())

            # Replace 'your-audio-file.mp3' with the path to your MP3 file
            audio = MP3(file)

            # Get the duration in seconds
            duration = audio.info.length

            dic = durations.get(num)
            if dic is None:
                dic = {}
                durations[num] = dic

            dic[code3] = duration

        os.chdir(current_dir)    

    with open("data/durations.json", 'w', encoding='utf-8') as file:
        json.dump(durations, file, ensure_ascii=False, indent=4)


def concat_mp3_files():
    with open("data/durations.json", 'r', encoding='utf-8') as file:
        durations = json.load(file)

    with open("data/docs.json", 'r', encoding='utf-8') as file:
        docs = json.load(file)

    for code3 in lang_codes:
        target_dir = f'../../firebase.ts/public/lib/i18n/audio/{code3}'
        os.chdir(target_dir)

        for doc in docs:
            speechIds = doc["speechIds"]
            docId     = doc["docId"]
            print(f'{docId} {doc["name"]} {speechIds}')

            for idx, speech_id in enumerate(speechIds):            
                dic = durations[str(speech_id)]
                times = [dic[key] for key in dic]
                max_duration = max(times)
                duration = dic[code3]

                if idx == 0:
                    combined  = AudioSegment.from_mp3(f'{speech_id}.mp3')
                else:
                    combined += AudioSegment.from_mp3(f'{speech_id}.mp3')

                if duration < max_duration:
                    silent_time = int(1000 * (max_duration - duration))
                    combined += AudioSegment.silent(duration=silent_time)

            output_path = f"../../docs/{docId}/{code3}.mp3"
            combined.export(output_path, format="mp3")
            print(output_path)

            break

        os.chdir(current_dir)    

def make_subtitles():
    with open("data/durations.json", 'r', encoding='utf-8') as file:
        durations = json.load(file)

    with open("data/docs.json", 'r', encoding='utf-8') as file:
        docs = json.load(file)

    lang_dic = {}
    for code3 in lang_codes:
        text_path = f'{i18n_dir}/translation/{code3}.txt'
        with open(text_path, 'r', encoding='utf-8') as file:
            lines = file.readlines()

        lines = [x.strip() for x in lines]
        lines = [x for x in lines if x != ""]
        id_texts = [ x.split(":") for x in lines  ]
        id_texts = [ (int(x[0].strip()), x[1].strip()) for x in id_texts ]
        text_dic = dict(id_texts)
        lang_dic[code3] = text_dic

    for doc in docs:
        speechIds = doc["speechIds"]
        docId     = doc["docId"]

        doc_dir = f'{i18n_dir}/docs/{docId}'
        os.chdir(doc_dir)


        print(f'{doc_dir}')

        for code3 in lang_codes:
            text_dic = lang_dic[code3]

            lines = []
            position = 0
            for idx, speech_id in enumerate(speechIds):            
                dic = durations[str(speech_id)]
                times = [dic[key] for key in dic]
                max_duration = max(times)
                text = text_dic[speech_id]

                lines.append(f"{idx + 1}")
                lines.append(f"{format_seconds(position)} --> {format_seconds(position + max_duration)}")
                lines.append(text)
                lines.append("")

                position += max_duration

            srt_path = f"{code3}.srt"
            print(srt_path)
            with open(srt_path, 'w', encoding='utf-8') as file:
                file.write("\n".join(lines))

        break

        os.chdir(current_dir)    




def fix_file_name():
    for code3 in lang_codes:
        target_dir = f'../../firebase.ts/public/lib/i18n/audio/{code3}'

        os.chdir(target_dir)
        for file in glob.glob(f"*.mp3"):
            (name, ext) = file.split(".")
            name2 = name.strip()
            if name2 != name:
                new_file = f"{name2}.mp3"
                os.rename(file, new_file)
                print(file, new_file)

        os.chdir(current_dir)    

if __name__ == '__main__':
    # make_durations()
    # concat_mp3_files()
    make_subtitles()

    os.chdir(current_dir)    
