import os
import sys
import json
from pathlib import Path

import azure.cognitiveservices.speech as speechsdk

with open("data/info.json", 'r', encoding='utf-8') as file:
    info = json.load(file)

# Replace with your subscription key and service region
subscription_key = info["subscription_key"]
region = info["region"]

lang_list : list[tuple[str, str]] = [
    ("ara", "ar-EG", "SalmaNeural"),
    ("chi", "zh-CN", "XiaoxiaoNeural"),
    ("eng", "en-US", "AriaNeural"), # JennyNeural
    ("fre", "fr-FR", "DeniseNeural"),
    ("ger", "de-DE", "KatjaNeural"),
    ("hin", "hi-IN", "AnanyaNeural"),
    ("ind", "id-ID", "GadisNeural"),
    ("jpn", "ja-JP", "AoiNeural"), # NanamiNeural AoiNeural MayuNeural ShioriNeural
    ("kor", "ko-KR", "SunHiNeural"), # SunHiNeural JiMinNeural SeoHyeonNeural SoonBokNeural YuJinNeural
    ("rus", "ru-RU", "SvetlanaNeural"),
    ("spa", "es-ES", "ElviraNeural"),
    ("por", "pt-PT", "RaquelNeural")
]

lang_dic = {
    "ara" : "ara",
    "chi" : "chi",
    "eng" : "eng",
    "fre" : "fra",
    "ger" : "ger",
    "hin" : "hin",
    "ind" : "ind",
    "jpn" : "jpn",
    "kor" : "kor",
    "rus" : "rus",
    "spa" : "spa",
    "por" : "por",
}


lang_list2 = [x[:2] for x in lang_list]
lang_dict = dict(lang_list2)

voice_dict = dict( [x[1:] for x in lang_list] )

def make_speech_config(voice_name : str):
    # Initialize the speech configuration
    speech_config = speechsdk.SpeechConfig(subscription=subscription_key, region=region)

    speech_config.speech_synthesis_voice_name = voice_name
    speech_config.set_speech_synthesis_output_format(speechsdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3)
    # speech_synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=None)

    return speech_config

def make_audo_file(speech_config, text, output_filename):
    audio_config = speechsdk.audio.AudioOutputConfig(filename=output_filename)

    # Initialize the synthesizer
    synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=audio_config)

    # Synthesize the text to speech
    result = synthesizer.speak_text_async(text).get()

    # Check the result
    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        print(text)
    elif result.reason == speechsdk.ResultReason.Canceled:
        cancellation_details = result.cancellation_details
        print(f"Speech synthesis canceled: {cancellation_details.reason}")
        if cancellation_details.reason == speechsdk.CancellationReason.Error:
            if cancellation_details.error_details:
                print(f"Error details: {cancellation_details.error_details}")
        print("Did you set the speech resource key and region values correctly?")


def text_to_speech(target_dir : str, num_text : list[tuple[int, str]], voice_name : str):
    speech_config = make_speech_config(voice_name)

    for num, text in num_text:
        output_filename = f'{target_dir}/{num}.mp3'
        make_audo_file(speech_config, text, output_filename)


def get_short_name(lang_code : str, voice_name : str):
    k1 = voice_name.find(lang_code)
    if k1 == -1:
        return None
    else:
        k1 += 6
        k2 = str(voice_name).find(")", k1)
        name = str(voice_name)[k1:k2].strip()

        return name

def list_voices(lang_code : str):
    # Initialize the speech configuration
    speech_config = speechsdk.SpeechConfig(subscription=subscription_key, region=region)

    # Create the synthesizer
    synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config)

    # Get the list of voices
    voices_result = synthesizer.get_voices_async().get()

    short_voice_name = voice_dict[lang_code]

    voice_name = None
    voice_name_list = []
    if voices_result.reason == speechsdk.ResultReason.VoicesListRetrieved:
        voices = voices_result.voices
        for voice in voices:
            if voice.locale == lang_code and voice.gender == speechsdk.SynthesisVoiceGender.Female:

                    name = get_short_name(lang_code, voice.name)
                    if name is None:
                        print(f"Name: {voice_name}, Locale: {voice.locale}, Gender: {voice.gender}, Voice Path: {voice.voice_path}")
                    else:
                        print(f"{name}[{voice.name}]")

                        voice_name_list.append(voice.name)

                        if short_voice_name == name:
                            voice_name = voice.name
    else:
        print(f"Failed to retrieve voices. Error details: {voices_result.error_details}")

    print()
    print(f"select the voice. [{short_voice_name}] => [{voice_name}]")
    return [voice_name, voice_name_list]


def make_audio_files(mode, code3, voice_name):
    target_dir = f'../../firebase.ts/public/lib/i18n/audio/{code3}'


    text_path = f"../../i18n.ts/public/lib/i18n/translation/{code3}.txt"
    with open(text_path, 'r', encoding='UTF-8') as f:
        lines = f.readlines()

    num_text = []
    for line in lines:
        line = line.strip()
        if line == "":
            continue

        # print(f"[{line}]")
        [num, text] = line.split(":")
        num  = num.strip()
        text = text.strip()

        output_filename = f'{target_dir}/{num}.mp3'
        if os.path.isfile(output_filename):
            continue

        if int(num) < 23:
            continue

        print(num, text)

        num_text.append([num, text])

    if mode == 1:
        num_text = num_text[:1]
    elif mode == 2:
        num_text = num_text[:10]
    elif mode == 3:
        pass
    else:
        return
    
    print("\nnum_text=", num_text)
    target_dir = f'../../firebase.ts/public/lib/i18n/audio/{code3}'
    text_to_speech(target_dir, num_text, voice_name)

def test_speech(lang_code, voice_name_list):
    texts = [
        "“생명, 감사합니다” 어린이부터 노인까지, 전세계의 모든 사람들이 생명을 존중하고 생명에 대한 감사로 감싸인 그런 세계를 만들고 싶다."
    ]

    for voice_name in voice_name_list:
        k = voice_name.find("[")
        short_name = get_short_name(lang_code, voice_name)
        print(f"short:[{short_name}][{voice_name}]")

        speech_config = make_speech_config(voice_name)
        for i, text in enumerate(texts):
            output_filename = f"./audio/{i+1}-{short_name}.mp3"
            print(output_filename)
            make_audo_file(speech_config, text, output_filename)

if __name__ == '__main__':
    args = sys.argv
    print(len(args), args[0], args[1])
    if 2 <= len(args):

        code3      = args[1]
        lang_code  = lang_dict[code3]
        short_voice_name = voice_dict[lang_code]

        [voice_name, voice_name_list] = list_voices(lang_code)
        print(code3, lang_code, short_voice_name, voice_name)

        if len(args) == 3:
            mode       = int(args[2])

            if mode == 0:
                test_speech(lang_code, voice_name_list)

            elif voice_name is not None and 0 < mode:
                make_audio_files(mode, code3, voice_name)

